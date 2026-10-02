import OpenAI from "openai";
import { chromium, type Page } from "playwright";
import { compileCapability, writeCapability, type RecordedStep } from "../src/artifact.js";
import { headless, mockUrl, model, requireOpenAIKey } from "../src/env.js";
import { redactForLog } from "../src/policy.js";
import { assertAllowed, clickByRole, formatObserve, observe, typeByLabel } from "../src/surface.js";

const MAX_STEPS = 10;

/** Tools the model is allowed to call. We execute them; OpenAI never hits localhost. */
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Type into a labeled field. Replaces the current value.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string", description: "Accessible label, e.g. Member ID" },
          text: { type: "string" },
        },
        required: ["label", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "click",
      description: "Click a button or link by its accessible name.",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["button", "link"] },
          name: { type: "string" },
        },
        required: ["role", "name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Call when the goal is met or cannot be completed.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["success", "not_found", "failed"] },
          savingsBalance: { type: "string" },
          reason: { type: "string" },
        },
        required: ["status"],
      },
    },
  },
];

type FinishResult = {
  status: "success" | "not_found" | "failed";
  savingsBalance?: string;
  reason?: string;
};

type ToolOutcome = {
  toolResult: string;
  finished?: FinishResult;
  recorded?: RecordedStep;
};

/** CLI goal, or the official member-lookup example. */
function goalFromArgs(): string {
  return (
    process.argv.slice(2).join(" ").trim() ||
    "Look up member 12345 and read their current savings balance"
  );
}

/** Run one model-chosen action on the live page and return a fresh observe() for the next turn. */
async function applyTool(page: Page, step: number, name: string, args: Record<string, string>): Promise<ToolOutcome> {
  if (name === "type_text") {
    console.log(`step ${step}: type ${args.label}=${redactForLog(args.label, args.text)}`);
    await typeByLabel(page, args.label, args.text);
    return {
      toolResult: formatObserve(await observe(page)),
      recorded: {
        kind: "type",
        locator: { by: "label", value: args.label },
        literal: args.text,
      },
    };
  }

  if (name === "click") {
    console.log(`step ${step}: click ${args.role} "${args.name}"`);
    await clickByRole(page, args.role as "button" | "link", args.name);
    return {
      toolResult: formatObserve(await observe(page)),
      recorded: {
        kind: "click",
        locator: { by: "role", role: args.role as "button" | "link", name: args.name },
      },
    };
  }

  if (name === "finish") {
    const finished: FinishResult = {
      status: args.status as FinishResult["status"],
      savingsBalance: args.savingsBalance,
      reason: args.reason,
    };
    console.log(`step ${step}: finish ${JSON.stringify(finished)}`);
    return { toolResult: "ok", finished };
  }

  return { toolResult: `unknown tool ${name}` };
}

/** W3: observe → OpenAI decide → Playwright act, until finish or MAX_STEPS. */
async function discover(): Promise<void> {
  requireOpenAIKey();
  const client = new OpenAI();
  const goal = goalFromArgs();

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 800 });
  const page = await browser.newPage();
  let finished: FinishResult | undefined;
  const recorded: RecordedStep[] = [];

  try {
    await page.goto(mockUrl);
    assertAllowed(page.url());

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You operate a legacy core-banking member inquiry UI in a real browser. " +
          "Observe the accessibility tree, then type/click to finish the goal. " +
          "Stay on this app. Do not invent credentials. " +
          "When you can read a savings balance or a record-not-found message, call finish.",
      },
      {
        role: "user",
        content: `Goal: ${goal}\n\nCurrent UI:\n${formatObserve(await observe(page))}`,
      },
    ];

    let action = 0;
    for (let turn = 1; turn <= MAX_STEPS; turn++) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice: "required",
      });

      const message = response.choices[0]?.message;
      if (!message?.tool_calls?.length) {
        throw new Error("model returned no tool call");
      }
      messages.push(message);

      for (const call of message.tool_calls) {
        if (call.type !== "function") {
          continue;
        }
        const args = JSON.parse(call.function.arguments) as Record<string, string>;
        action += 1;
        const outcome = await applyTool(page, action, call.function.name, args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: outcome.toolResult,
        });
        if (outcome.recorded) {
          recorded.push(outcome.recorded);
        }
        if (outcome.finished) {
          finished = outcome.finished;
        }
      }

      if (finished) {
        break;
      }
    }

    if (!finished) {
      throw new Error(`stopped after ${MAX_STEPS} steps without finish`);
    }

    if (finished.status === "success" && finished.savingsBalance) {
      console.log(`savingsBalance=${finished.savingsBalance}`);
    } else {
      console.log(`outcome=${finished.status} reason=${finished.reason ?? ""}`);
    }

    // W4: compile the reusable capability. Do not persist the model transcript.
    if (finished.status === "success" || finished.status === "not_found") {
      const artifact = compileCapability({ goal, entryUrl: mockUrl, recorded });
      const saved = await writeCapability(artifact);
      console.log(`artifact=${saved}`);
    }

    if (!headless) {
      await page.waitForTimeout(4000);
    }
  } finally {
    await browser.close();
  }
}

await discover();
