import { config } from "dotenv";

// Load OPENAI_API_KEY from .env. Never log the value.
config();

/** Fail fast if the operator forgot to create .env — discovery cannot run without a real model. */
export function requireOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY is missing. Copy .env.example to .env and add your key.");
  }
  return key;
}

/** Mock core-banking origin. Overridable so tests can point at another port. */
export const mockUrl = process.env.MOCK_URL ?? "http://127.0.0.1:3000";

/** Cheap default for a short tool-calling loop; override with OPENAI_MODEL if needed. */
export const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

/** Visible Chromium unless HEADLESS=1. */
export const headless = process.env.HEADLESS === "1";
