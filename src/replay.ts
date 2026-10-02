import { mkdir } from "node:fs/promises";
import path from "node:path";
import { type Page } from "playwright";
import { type Capability } from "./artifact.js";
import { assertAllowed, clickByRole, extractByRowheader, typeByLabel } from "./surface.js";

export type ReplaySuccess = {
  kind: "success";
  status: "success";
  outputs: Record<string, string>;
};

export type ReplayBusiness = {
  kind: "business";
  status: "NOT_FOUND" | "VALIDATION_ERROR" | "APP_ERROR";
  reason: string;
};

export type ReplayFailure = {
  kind: "failed";
  status: "failed";
  step: number;
  expected: string;
  observed: string;
  screenshot?: string;
};

export type ReplayResult = ReplaySuccess | ReplayBusiness | ReplayFailure;

export type ReplayOptions = {
  /** Force extract to look for a missing control — demo hard failure + screenshot. */
  brokenExtractName?: string;
};

type Gate = "success" | "NOT_FOUND" | "VALIDATION_ERROR" | "APP_ERROR" | "unknown";

/** Resolve a type step. Empty string is allowed so the mock can show validation. */
function typeValue(step: Capability["steps"][number], inputs: Record<string, string>): string {
  if (step.kind !== "type") {
    throw new Error("typeValue called on a non-type step");
  }
  if (step.bindInput) {
    if (!(step.bindInput in inputs)) {
      throw new Error(`missing input ${step.bindInput}`);
    }
    return inputs[step.bindInput] ?? "";
  }
  if (step.literal !== undefined) {
    return step.literal;
  }
  throw new Error("type step has neither bindInput nor literal");
}

/** Classify the page after Search. Business outcomes first; unknown is a hard fail. */
async function checkpoint(page: Page, capability: Capability): Promise<{ gate: Gate; observed: string }> {
  const observed = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const { validationText, appErrorText, notFoundText, successText } = capability.checkpoint;

  if (observed.includes(validationText)) {
    return { gate: "VALIDATION_ERROR", observed: validationText };
  }
  if (observed.includes(appErrorText)) {
    return { gate: "APP_ERROR", observed: appErrorText };
  }
  if (observed.includes(notFoundText)) {
    return { gate: "NOT_FOUND", observed: notFoundText };
  }
  if (observed.includes(successText)) {
    return { gate: "success", observed: successText };
  }
  return { gate: "unknown", observed };
}

async function saveFailureScreenshot(page: Page): Promise<string | undefined> {
  try {
    if (page.isClosed()) {
      return undefined;
    }
    const dir = path.join(process.cwd(), "evidence");
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "replay-failure.png");
    await page.screenshot({ path: filePath });
    return filePath;
  } catch {
    return undefined;
  }
}

/** W5/W6: run a saved capability with no LLM. Classify business vs hard failure. */
export async function replayCapability(
  page: Page,
  capability: Capability,
  inputs: Record<string, string>,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  await page.goto(capability.target.entryUrl);
  assertAllowed(page.url());

  const outputs: Record<string, string> = {};

  for (let i = 0; i < capability.steps.length; i++) {
    const step = capability.steps[i];
    const stepNo = i + 1;

    try {
      if (step.kind === "type") {
        await typeByLabel(page, step.locator.value, typeValue(step, inputs));
      } else if (step.kind === "click") {
        await clickByRole(page, step.locator.role, step.locator.name);
        const { gate, observed } = await checkpoint(page, capability);
        if (gate === "NOT_FOUND" || gate === "VALIDATION_ERROR" || gate === "APP_ERROR") {
          return { kind: "business", status: gate, reason: observed };
        }
        if (gate === "unknown") {
          const screenshot = await saveFailureScreenshot(page);
          return {
            kind: "failed",
            status: "failed",
            step: stepNo,
            expected: capability.checkpoint.successText,
            observed,
            screenshot,
          };
        }
      } else if (step.kind === "extract") {
        const name = options.brokenExtractName ?? step.locator.name;
        const timeoutMs = options.brokenExtractName ? 3000 : 15_000;
        outputs[step.bindOutput] = await extractByRowheader(page, name, timeoutMs);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const screenshot = await saveFailureScreenshot(page);
      return {
        kind: "failed",
        status: "failed",
        step: stepNo,
        expected: `${step.kind} to succeed`,
        observed: message,
        screenshot,
      };
    }
  }

  return { kind: "success", status: "success", outputs };
}
