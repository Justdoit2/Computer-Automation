import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { DEFAULT_CAPABILITY_PATH, loadCapability } from "../src/artifact.js";
import { type ReplayOptions, type ReplayResult, replayCapability } from "../src/replay.js";

const EVIDENCE = path.join(process.cwd(), "evidence");

function formatResult(command: string, result: ReplayResult): string {
  const lines = [`command: ${command}`, `kind: ${result.kind}`, `status: ${result.status}`];
  if (result.kind === "success") {
    lines.push(`savingsBalance: ${result.outputs.savingsBalance ?? ""}`);
  } else if (result.kind === "business") {
    lines.push(`reason: ${result.reason}`);
  } else {
    lines.push(`step: ${result.step}`);
    lines.push(`expected: ${result.expected}`);
    lines.push(`observed: ${result.observed}`);
    if (result.screenshot) {
      lines.push(`screenshot: ${path.relative(process.cwd(), result.screenshot)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function capture(
  command: string,
  fileName: string,
  inputs: Record<string, string>,
  options: ReplayOptions = {},
): Promise<void> {
  const capability = await loadCapability(DEFAULT_CAPABILITY_PATH);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const result = await replayCapability(page, capability, inputs, options);
    await writeFile(path.join(EVIDENCE, fileName), formatResult(command, result), "utf8");
    console.log(`wrote evidence/${fileName} (${result.status})`);
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  await copyFile(DEFAULT_CAPABILITY_PATH, path.join(EVIDENCE, "lookup-member.v1.json"));
  console.log("wrote evidence/lookup-member.v1.json");

  await capture("npm run replay -- --member 12345", "replay-12345.log", { memberId: "12345" });
  await capture("npm run replay -- --member 12346", "replay-12346.log", { memberId: "12346" });
  await capture("npm run replay -- --member 99999", "replay-99999.log", { memberId: "99999" });
  await capture("npm run replay -- --member EMPTY", "replay-EMPTY.log", { memberId: "" });
  await capture("npm run replay -- --member 00000", "replay-00000.log", { memberId: "00000" });
  await capture("npm run replay -- --member 12345 --broken", "replay-broken.log", { memberId: "12345" }, {
    brokenExtractName: "Does not exist",
  });
}

await main();
