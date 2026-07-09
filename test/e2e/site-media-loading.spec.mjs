import { expect, test } from "@playwright/test";

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
  test.setTimeout(60_000);
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
  const desktopRender = await renderCanvas.screenshot();
  expect(desktopRender.byteLength).toBeGreaterThan(10_000);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await frame.evaluate((element) => {
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
  const mobileRender = await renderCanvas.screenshot();
  expect(mobileRender.byteLength).toBeGreaterThan(10_000);
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
