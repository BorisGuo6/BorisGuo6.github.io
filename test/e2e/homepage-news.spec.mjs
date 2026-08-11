import { expect, test } from "@playwright/test";

test("homepage News includes publication awards in minimal and full modes", async ({ page }) => {
  await page.goto("/");

  const news = page.locator("#news-list");
  await expect(news).toContainText("TelePreview won the Best Paper Award");
  await expect(news).toContainText("ICRA 2025 Best Paper Award on Robot Manipulation and Locomotion");
  await expect(news).toContainText("Best Robotics Paper Award");
  await expect(news).not.toContainText("Best Demo Award Finalist");

  await page.evaluate(() => window.applyMode(true));
  await expect(news).toContainText("SayWhen won the Best Demo Award Finalist");
});

test("homepage uses one heading weight and shows the updated advisor name", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h2 b, h2 strong")).toHaveCount(0);

  await page.evaluate(() => window.applyMode(true));
  await expect(page.locator("#entre-entries")).toContainText("华智AI");
  await expect(page.locator("#entre-entries")).not.toContainText("TBA");
});
