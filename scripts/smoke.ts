import { chromium } from "playwright";

const baseUrl = process.env.MOCK_URL ?? "http://127.0.0.1:3000";

const headless = process.env.HEADLESS === "1";
const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 800 });
const page = await browser.newPage();

try {
  await page.goto(baseUrl);
  await page.getByLabel("Member ID").fill("12345");
  await page.getByRole("button", { name: "Search" }).click();
  await page.waitForURL(/member\.html/);

  const balance = (await page.getByRole("rowheader", { name: "Savings balance" }).locator("xpath=../td").innerText()).trim();

  console.log(`savingsBalance=${balance}`);
  if (balance !== "$1,240.55") {
    throw new Error(`unexpected balance: ${balance}`);
  }

  // Headed demo: leave the member record on screen before Chromium exits.
  if (!headless) {
    await page.waitForTimeout(4000);
  }
} finally {
  await browser.close();
}
