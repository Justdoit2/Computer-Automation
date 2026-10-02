import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { type Page } from "playwright";

export type Controller = "agent" | "human";

export type HumanAction = {
  tag: string;
  name: string;
  at: string;
};

export type Intervention = {
  capabilityId: string;
  goal: string;
  step: number;
  reason: string;
  url: string;
  title: string;
  controller: Controller;
  screenshot: string;
  createdAt: string;
};

const EVIDENCE = path.join(process.cwd(), "evidence");

/** Who is allowed to drive the live session right now. */
export function createControl(): { get: () => Controller; set: (next: Controller) => Controller } {
  let controller: Controller = "agent";
  return {
    get: () => controller,
    set: (next) => {
      controller = next;
      return controller;
    },
  };
}

/** Ask the operator to use the same Chromium window, then press Enter. */
export async function waitForHumanResume(prompt: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>((resolve) => {
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

const recordedClicks: HumanAction[] = [];

/** Click logger that lives in the page; Playwright re-runs it after Search navigates. */
function installClickLogger(): void {
  const w = window as unknown as {
    __recordHumanAction?: (action: HumanAction) => void;
    __humanClickLoggerInstalled?: boolean;
  };
  if (w.__humanClickLoggerInstalled) {
    return;
  }
  w.__humanClickLoggerInstalled = true;
  document.addEventListener(
    "click",
    (event) => {
      const el = event.target as HTMLElement | null;
      void w.__recordHumanAction?.({
        tag: el?.tagName ?? "UNKNOWN",
        name: (el?.innerText || el?.getAttribute("aria-label") || "").trim().slice(0, 80),
        at: new Date().toISOString(),
      });
    },
    true,
  );
}

/**
 * Record human clicks in Node so a form navigation (Search → member.html)
 * does not wipe the log with the old window.
 */
export async function startHumanClickLog(page: Page): Promise<void> {
  recordedClicks.length = 0;
  await page.exposeFunction("__recordHumanAction", (action: HumanAction) => {
    recordedClicks.push(action);
  });
  await page.addInitScript(installClickLogger);
  await page.evaluate(installClickLogger);
}

export function readHumanClickLog(): HumanAction[] {
  return [...recordedClicks];
}

export async function writeIntervention(intervention: Intervention): Promise<string> {
  await mkdir(EVIDENCE, { recursive: true });
  const filePath = path.join(EVIDENCE, "intervention.json");
  await writeFile(filePath, `${JSON.stringify(intervention, null, 2)}\n`, "utf8");
  return filePath;
}

export async function writeHandoffLog(payload: unknown): Promise<string> {
  await mkdir(EVIDENCE, { recursive: true });
  const filePath = path.join(EVIDENCE, "handoff.json");
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

export async function screenshotHandoff(page: Page, name: string): Promise<string> {
  await mkdir(EVIDENCE, { recursive: true });
  const filePath = path.join(EVIDENCE, name);
  await page.screenshot({ path: filePath });
  return filePath;
}
