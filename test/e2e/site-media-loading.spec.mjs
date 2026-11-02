import { expect, test } from "@playwright/test";

const RUNTIME_BOOT_TIMEOUT = 60_000;

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
      { timeout: RUNTIME_BOOT_TIMEOUT },
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
  expect(runtimeRequests).toHaveLength(0);

  const launchButton = page.getByRole("button", { name: "Launch robot demo" });
  await expect(launchButton).toBeVisible();
  await launchButton.click();
  const frame = page.locator(".robot-demo-runtime-frame");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("src", /\/assets\/robot-demo-runtime\/embed\.html/);
  await expect.poll(() => runtimeRequests.length).toBeGreaterThan(0);
  await expect(frame.contentFrame().locator("#root")).toHaveCount(1, {
    timeout: RUNTIME_BOOT_TIMEOUT,
  });
  const renderCanvas = frame.contentFrame().locator('canvas[data-engine^="three.js"]');
  await expect(renderCanvas).toHaveCount(1, { timeout: RUNTIME_BOOT_TIMEOUT });
  await expect(renderCanvas).toBeVisible();
  await expectCanvasRendered(renderCanvas);

  // Resize the live runtime instead of cold-starting MuJoCo and ONNX twice.
  // The same rendered canvas still exercises the mobile responsive path.
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFrame = page.locator(".robot-demo-runtime-frame");
  await expect(mobileFrame).toBeVisible();
  await expect(mobileFrame).toHaveAttribute("src", /\/assets\/robot-demo-runtime\/embed\.html/);
  await mobileFrame.scrollIntoViewIfNeeded();
  const mobileRenderCanvas = mobileFrame.contentFrame().locator('canvas[data-engine^="three.js"]');
  await expect(mobileRenderCanvas).toHaveCount(1, { timeout: RUNTIME_BOOT_TIMEOUT });
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

for (const { hash, slide, count } of [
  { hash: "1/6", slide: 9, count: 1 },
  { hash: "1/18", slide: 21, count: 5 },
  { hash: "1/22", slide: 25, count: 1 },
  { hash: "2/15", slide: 42, count: 1 },
  { hash: "2/16", slide: 43, count: 10 },
  { hash: "2/17", slide: 44, count: 4 },
  { hash: "2/18", slide: 45, count: 25 },
  { hash: "3/19", slide: 65, count: 1 },
  { hash: "3/20", slide: 66, count: 1 },
  { hash: "3/21", slide: 67, count: 1 },
  { hash: "3/22", slide: 68, count: 1 },
  { hash: "4/6", slide: 75, count: 2 },
  { hash: "5/10", slide: 87, count: 1 },
  { hash: "6/6", slide: 118, count: 1 },
  { hash: "7/3", slide: 124, count: 1 },
  { hash: "7/7", slide: 128, count: 1 },
  { hash: "7/9", slide: 130, count: 1 },
]) {
  test(`presentation slide ${slide} plays again after leaving and returning`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto(`/present/#/${hash}`);
    await expect(page.locator(".reveal.ready")).toBeVisible();
    const videos = page.locator(`section[data-output-slide="${slide}"].present video`);

    for (let visit = 0; visit < 3; visit += 1) {
      await expect(videos).toHaveCount(count);
      await expect.poll(() => videos.evaluateAll((players) => players.every((player) =>
        player.readyState >= 2 && !player.paused && !player.error && player.currentTime > 0
      )), { timeout: 20_000 }).toBe(true);
      expect(await page.locator('section[data-output-slide]:not(.present) video[src]').count()).toBe(0);
      const times = await videos.evaluateAll((players) => players.map((player) => player.currentTime));
      await expect.poll(() => videos.evaluateAll((players, previous) =>
        players.every((player, index) => player.currentTime !== previous[index]), times
      )).toBe(true);

      if (visit < 2) {
        await page.locator("body").press("ArrowUp");
        await expect(videos).toHaveCount(0);
        await page.locator("body").press("ArrowDown");
      }
    }
  });
}

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
