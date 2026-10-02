import { chromium } from "playwright";
import { mockUrl } from "../src/env.js";
import {
  createControl,
  readHumanClickLog,
  screenshotHandoff,
  startHumanClickLog,
  waitForHumanResume,
  writeHandoffLog,
  writeIntervention,
} from "../src/handoff.js";
import { extractByRowheader, typeByLabel } from "../src/surface.js";

/**
 * W8 demo: agent types the member id, then cedes the SAME browser.
 * You click Search. Press Enter. Agent extracts the balance.
 */
async function main(): Promise<void> {
  const control = createControl();
  const browser = await chromium.launch({ headless: false, slowMo: 400 });
  const page = await browser.newPage();

  try {
    control.set("agent");
    await page.goto(mockUrl);
    await typeByLabel(page, "Member ID", "12345");

    const before = await screenshotHandoff(page, "handoff-before.png");
    const interventionPath = await writeIntervention({
      capabilityId: "lookup-member",
      goal: "Look up member 12345 and read their current savings balance",
      step: 2,
      reason: "Agent typed the member id. Search is left to a human on this live session.",
      url: page.url(),
      title: await page.title(),
      controller: "human",
      screenshot: before,
      createdAt: new Date().toISOString(),
    });

    await startHumanClickLog(page);
    control.set("human");
    console.log(`controller=${control.get()}`);
    console.log(`intervention=${interventionPath}`);
    console.log("Same Chromium window is yours. Click Search, then come back here.");

    await waitForHumanResume("Press Enter when you are done (hand control back): ");

    const humanActions = readHumanClickLog();
    control.set("agent");
    console.log(`controller=${control.get()}`);
    console.log(`humanActions=${JSON.stringify(humanActions)}`);

    const after = await screenshotHandoff(page, "handoff-after.png");
    const balance = await extractByRowheader(page, "Savings balance");
    console.log(`savingsBalance=${balance}`);

    const logPath = await writeHandoffLog({
      controllerAfter: control.get(),
      humanActions,
      savingsBalance: balance,
      screenshots: { before, after },
    });
    console.log(`handoff=${logPath}`);
  } finally {
    await browser.close();
  }
}

await main();
