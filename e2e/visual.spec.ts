import { expect, test } from "@playwright/test";

test("visual smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Monopoly Online" })).toBeVisible();
  await page.screenshot({ path: "test-results/visual-home.png", fullPage: true });
  // responsive check: tablet width still shows actions
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByRole("button", { name: "Create Room" })).toBeVisible();
  await page.screenshot({ path: "test-results/visual-home-tablet.png", fullPage: true });
});
