import { expect, test } from "@playwright/test";

async function inspectCanvasRender(canvas) {
  const result = await canvas.evaluate(
    (element) =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const probe = document.createElement("canvas");
            probe.width = 64;
            probe.height = 64;
            const context = probe.getContext("2d", { willReadFrequently: true });
            context.drawImage(element, 0, 0, probe.width, probe.height);
            const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
            const colors = new Set();
            let nonTransparent = 0;
            let minimumChannel = 255;
            let maximumChannel = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
              const red = pixels[offset];
              const green = pixels[offset + 1];
              const blue = pixels[offset + 2];
              const alpha = pixels[offset + 3];
              if (alpha > 0) nonTransparent += 1;
              minimumChannel = Math.min(minimumChannel, red, green, blue);
              maximumChannel = Math.max(maximumChannel, red, green, blue);
              colors.add(`${red},${green},${blue},${alpha}`);
            }

            resolve({
              nonTransparent,
              uniqueColors: colors.size,
              channelRange: maximumChannel - minimumChannel,
            });
          });
        });
      }),
  );
  return result;
}

async function expectCanvasRendered(canvas) {
  await expect
    .poll(
      async () => {
        const render = await inspectCanvasRender(canvas);
        return (
          render.nonTransparent > 2_048 &&
          render.uniqueColors > 8 &&
          render.channelRange > 12
        );
      },
      { timeout: 45_000 },
    )
    .toBe(true);
}

test("homepage uses the device viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /width=device-width/);
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.clientWidth).toBe(390);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
});

test("homepage robot runtime loads only after an explicit launch", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const runtimeRequests = [];
  const brokenRuntimePreloads = [];
  page.on("request", (request) => {
    if (request.url().includes("/assets/robot-demo-runtime/")) {
      runtimeRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 404 && /^\/assets\/(ActPolicy|rolldown-runtime|r3f)-/.test(path)) {
      brokenRuntimePreloads.push(path);
    }
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(runtimeRequests).toHaveLength(0);

  const launchButton = page.getByRole("button", { name: "Launch robot demo" });
  await expect(launchButton).toBeVisible();
  await launchButton.click();
  const frame = page.locator(".robot-demo-runtime-frame");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /\/assets\/robot-demo-runtime\/embed\.html/);
  await expect.poll(() => runtimeRequests.length).toBeGreaterThan(0);
  await expect.poll(() => frame.contentFrame().locator("#root").count()).toBe(1);
  const renderCanvas = frame.contentFrame().locator('canvas[data-engine^="three.js"]');
  await expect.poll(() => renderCanvas.count(), { timeout: 30_000 }).toBe(1);
  await expect(renderCanvas).toBeVisible();
  await expectCanvasRendered(renderCanvas);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Launch robot demo" }).click();
  const mobileFrame = page.locator(".robot-demo-runtime-frame");
  await expect(mobileFrame).toBeVisible();
  await expect(mobileFrame).toHaveAttribute("src", /\/assets\/robot-demo-runtime\/embed\.html/);
  const mobileRenderCanvas = mobileFrame.contentFrame().locator('canvas[data-engine^="three.js"]');
  await expect.poll(() => mobileRenderCanvas.count(), { timeout: 30_000 }).toBe(1);
  await expect(mobileRenderCanvas).toBeVisible();
  const mobileLayout = await mobileFrame.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      frameLeft: rect.left,
      frameRight: rect.right,
      frameWidth: rect.width,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(mobileLayout.frameLeft).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.frameRight).toBeLessThanOrEqual(mobileLayout.viewportWidth + 1);
  expect(mobileLayout.frameWidth).toBeGreaterThan(300);
  await expectCanvasRendered(mobileRenderCanvas);
  expect(brokenRuntimePreloads).toEqual([]);
});

test("presentation attaches video sources only for the active slide", async ({ page }) => {
  await page.goto("/present/");
  await expect.poll(() => page.locator("section[data-output-slide]").count()).toBeGreaterThan(100);
  await expect(page.locator(".reveal.ready")).toBeVisible();
  expect(await page.locator(".reveal video[src]").count()).toBe(0);

  await page.evaluate(() => window.Reveal.slide(1, 6));
  const activeSlide = page.locator('section[data-output-slide="9"].present');
  await expect(activeSlide).toBeVisible();
  await expect(activeSlide.locator("video[src]")).toHaveCount(1);
  expect(await page.locator('section[data-output-slide]:not(.present) video[src]').count()).toBe(0);
});

test("weekly brief keeps its mobile navigation compact and tables locally scrollable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/weekly-briefs/");

  const layout = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar");
    const nav = topbar?.querySelector("nav");
    const tableCard = document.querySelector(".table-card");
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      topbarHeight: topbar?.getBoundingClientRect().height || 0,
      navClientWidth: nav?.clientWidth || 0,
      navScrollWidth: nav?.scrollWidth || 0,
      tableClientWidth: tableCard?.clientWidth || 0,
      tableScrollWidth: tableCard?.scrollWidth || 0,
      tableOverflowX: tableCard ? getComputedStyle(tableCard).overflowX : "",
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.topbarHeight).toBeLessThanOrEqual(64);
  expect(layout.navScrollWidth).toBeGreaterThan(layout.navClientWidth);
  expect(layout.tableScrollWidth).toBeGreaterThanOrEqual(layout.tableClientWidth);
  expect(layout.tableOverflowX).toBe("auto");
});
