import { chromium } from "playwright";
import { DEFAULT_CAPABILITY_PATH, loadCapability } from "../src/artifact.js";
import { headless } from "../src/env.js";
import { replayCapability } from "../src/replay.js";

/** Parse `--member 12345` and optional `--broken` (injected hard failure). */
function parseArgs(): { memberId: string; broken: boolean } {
  const argv = process.argv.slice(2);
  const broken = argv.includes("--broken");
  const eq = argv.find((arg) => arg.startsWith("--member="));
  let memberId: string | undefined = eq ? eq.slice("--member=".length) : undefined;
  if (memberId === undefined) {
    const flag = argv.indexOf("--member");
    if (flag >= 0 && argv[flag + 1] && !argv[flag + 1].startsWith("--")) {
      memberId = argv[flag + 1];
    }
  }
  if (memberId === undefined) {
    throw new Error("usage: npm run replay -- --member 12345");
  }
  if (memberId === "EMPTY") {
    memberId = "";
  }
  return { memberId, broken };
}

/** W5/W6 CLI: replay the artifact. Business outcomes exit 0; hard failures exit 1. */
async function main(): Promise<void> {
  const { memberId, broken } = parseArgs();
  const capability = await loadCapability(DEFAULT_CAPABILITY_PATH);

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 800 });
  const page = await browser.newPage();

  try {
    const result = await replayCapability(
      page,
      capability,
      { memberId },
      broken ? { brokenExtractName: "Does not exist" } : {},
    );

    if (result.kind === "success") {
      console.log(`savingsBalance=${result.outputs.savingsBalance ?? ""}`);
    } else if (result.kind === "business") {
      console.log(`outcome=${result.status} reason=${result.reason}`);
    } else {
      console.log(
        `outcome=failed step=${result.step} expected=${result.expected} observed=${result.observed}` +
          (result.screenshot ? ` screenshot=${result.screenshot}` : ""),
      );
      process.exitCode = 1;
    }

    if (!headless) {
      await page.waitForTimeout(4000);
    }
  } finally {
    await browser.close();
  }
}

await main();
