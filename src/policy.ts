import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const PolicySchema = z.object({
  allowedOrigins: z.array(z.string().min(1)),
  allowedActions: z.array(z.enum(["type", "click", "extract"])),
  blockedControlNames: z.array(z.string()),
  sensitiveLabelPatterns: z.array(z.string()),
});

export type Policy = z.infer<typeof PolicySchema>;

const POLICY_PATH = path.join(process.cwd(), "policy.json");

let cached: Policy | undefined;

/** Load committed policy once. Discover and replay both obey this file. */
export function loadPolicy(): Policy {
  if (!cached) {
    cached = PolicySchema.parse(JSON.parse(readFileSync(POLICY_PATH, "utf8")));
  }
  return cached;
}

/** Origin allowlist. about:blank is only for Playwright before the first goto. */
export function assertOriginAllowed(url: string, policy = loadPolicy()): void {
  if (url === "about:blank") {
    return;
  }
  const allowed = policy.allowedOrigins.some((origin) => url.startsWith(origin));
  if (!allowed) {
    throw new Error(`blocked navigation off allowlist: ${url}`);
  }
}

/** Block unknown action types and irreversible control names (Transfer, etc.). */
export function assertActionAllowed(
  action: "type" | "click" | "extract",
  controlName?: string,
  policy = loadPolicy(),
): void {
  if (!policy.allowedActions.includes(action)) {
    throw new Error(`blocked action type: ${action}`);
  }
  if (controlName) {
    const blocked = policy.blockedControlNames.some(
      (name) => name.toLowerCase() === controlName.toLowerCase(),
    );
    if (blocked) {
      throw new Error(`blocked irreversible control: ${controlName}`);
    }
    if (action === "type") {
      const sensitive = policy.sensitiveLabelPatterns.some((pattern) =>
        controlName.toLowerCase().includes(pattern.toLowerCase()),
      );
      if (sensitive) {
        throw new Error(`blocked typing into sensitive field: ${controlName}`);
      }
    }
  }
}

/** Never print secrets into logs. Member IDs are fine; passwords are not. */
export function redactForLog(label: string, value: string, policy = loadPolicy()): string {
  const sensitive = policy.sensitiveLabelPatterns.some((pattern) =>
    label.toLowerCase().includes(pattern.toLowerCase()),
  );
  if (sensitive) {
    return "[redacted]";
  }
  return value;
}
