import { type Page } from "playwright";
import { assertActionAllowed, assertOriginAllowed } from "./policy.js";

export type ObserveState = {
  url: string;
  title: string;
  aria: string;
};

/** Read what an operator / screen reader would see. No CSS selectors. */
export async function observe(page: Page): Promise<ObserveState> {
  assertAllowed(page.url());
  return {
    url: page.url(),
    title: await page.title(),
    aria: await page.locator("body").ariaSnapshot(),
  };
}

/** Flatten observe() into the text we send the model. */
export function formatObserve(state: ObserveState): string {
  return `url: ${state.url}\ntitle: ${state.title}\n\n${state.aria}`;
}

/** Retry a UI action a few times — transient slowness, not a new strategy. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === attempts) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 400 * i));
    }
  }
  throw lastError;
}

/** Type by accessible label (e.g. "Member ID"), not a brittle DOM id. */
export async function typeByLabel(page: Page, label: string, text: string): Promise<void> {
  assertActionAllowed("type", label);
  await withRetry(() => page.getByLabel(label).fill(text));
}

/** Click by role + name (e.g. button "Search"). Wait so the next observe sees the new screen. */
export async function clickByRole(page: Page, role: "button" | "link", name: string): Promise<void> {
  assertActionAllowed("click", name);
  await withRetry(async () => {
    await page.getByRole(role, { name }).click();
    await page.waitForLoadState("domcontentloaded");
  });
}

/** Read the cell next to a row header (e.g. Savings balance → $1,240.55). */
export async function extractByRowheader(page: Page, name: string, timeoutMs = 15_000): Promise<string> {
  assertActionAllowed("extract", name);
  return await withRetry(async () =>
    (await page.getByRole("rowheader", { name }).locator("xpath=../td").innerText({ timeout: timeoutMs })).trim(),
  );
}

/** Hard-stop if the page left the allowlisted origin. */
export function assertAllowed(url: string): void {
  assertOriginAllowed(url);
}
