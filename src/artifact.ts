import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** How we find a control. Role/label, not CSS — works when the DOM is ugly. */
export const LocatorSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("label"), value: z.string() }),
  z.object({ by: z.literal("role"), role: z.enum(["button", "link"]), name: z.string() }),
  z.object({ by: z.literal("rowheader"), name: z.string() }),
]);

export const StepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("type"),
    locator: z.object({ by: z.literal("label"), value: z.string() }),
    bindInput: z.string().optional(),
    literal: z.string().optional(),
  }),
  z.object({
    kind: z.literal("click"),
    locator: z.object({ by: z.literal("role"), role: z.enum(["button", "link"]), name: z.string() }),
  }),
  z.object({
    kind: z.literal("extract"),
    locator: z.object({ by: z.literal("rowheader"), name: z.string() }),
    bindOutput: z.string(),
  }),
]);

export const CapabilitySchema = z.object({
  apiVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  target: z.object({
    appId: z.string(),
    entryUrl: z.string(),
  }),
  inputs: z.record(
    z.string(),
    z.object({ type: z.literal("string"), description: z.string() }),
  ),
  outputs: z.record(
    z.string(),
    z.object({ type: z.literal("string"), description: z.string() }),
  ),
  steps: z.array(StepSchema),
  checkpoint: z.object({
    successText: z.string(),
    notFoundText: z.string(),
    validationText: z.string().default("Member ID is required"),
    appErrorText: z.string().default("Application error"),
  }),
  locatorStrategy: z.string(),
});

export type Capability = z.infer<typeof CapabilitySchema>;
export type RecordedStep = z.infer<typeof StepSchema>;

export const DEFAULT_CAPABILITY_PATH = path.join(process.cwd(), "capabilities", "lookup-member.v1.json");

/** Pull a member id out of the NL goal so we parameterize instead of baking 12345 into the flow. */
export function memberIdFromGoal(goal: string): string | undefined {
  const match = goal.match(/member\s+(\d+)/i);
  return match?.[1];
}

/**
 * Turn the executed type/click list into a reviewable capability.
 * Not the model transcript — only locators, bindings, and checkpoints.
 */
export function compileCapability(input: {
  goal: string;
  entryUrl: string;
  recorded: RecordedStep[];
}): Capability {
  const memberId = memberIdFromGoal(input.goal);
  const steps: RecordedStep[] = input.recorded.map((step) => {
    if (step.kind === "type" && memberId && step.literal === memberId) {
      return { kind: "type", locator: step.locator, bindInput: "memberId" };
    }
    return step;
  });

  const hasExtract = steps.some((step) => step.kind === "extract");
  if (!hasExtract) {
    steps.push({
      kind: "extract",
      locator: { by: "rowheader", name: "Savings balance" },
      bindOutput: "savingsBalance",
    });
  }

  return CapabilitySchema.parse({
    apiVersion: 1,
    id: "lookup-member",
    name: "Look up member savings balance",
    description:
      "Search core CIF by member id and return the savings balance. " +
      "Unknown ids are a business outcome (NOT_FOUND), not a crash.",
    target: {
      appId: "harbor-cu-core",
      entryUrl: input.entryUrl,
    },
    inputs: {
      memberId: { type: "string", description: "Member number supplied per invocation" },
    },
    outputs: {
      savingsBalance: { type: "string", description: "Formatted savings balance, e.g. $1,240.55" },
    },
    steps,
    checkpoint: {
      successText: "Savings balance",
      notFoundText: "Record not found",
      validationText: "Member ID is required",
      appErrorText: "Application error",
    },
    locatorStrategy:
      "Target controls the way an operator or screen reader would: accessible label and role+name. " +
      "No CSS ids or test IDs. Same locators can map to an a11y tree on desktop later.",
  });
}

/** Write the capability JSON. Reviewable by a human or a calling agent. */
export async function writeCapability(
  capability: Capability,
  filePath = DEFAULT_CAPABILITY_PATH,
): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(capability, null, 2)}\n`, "utf8");
  return filePath;
}

/** Load a saved capability. Replay uses this instead of calling the model. */
export async function loadCapability(filePath = DEFAULT_CAPABILITY_PATH): Promise<Capability> {
  const raw = await readFile(filePath, "utf8");
  return CapabilitySchema.parse(JSON.parse(raw));
}
