# REPORT

Take-home: computer-use discovery once, then deterministic replay of a typed capability. Demo goal: look up a member by id on a local mock core-CIF screen and return the savings balance. Saved runs: [`evidence/`](evidence/).

## 1. Architecture

One Node process. Three CLIs share one browser surface.

```
npm run discover  →  OpenAI tool loop  →  compileCapability()  →  capabilities/lookup-member.v1.json
npm run replay    →  loadCapability()  →  Playwright only (no model)
npm run handoff   →  same live page; controller agent|human
```

`src/surface.ts` is the only place that touches the page (observe, type-by-label, click-by-role, extract-by-rowheader). Policy runs before every action. `src/artifact.ts` is the contract. `src/replay.ts` is the production path.

**Language (our call).** The brief leaves language open. We chose TypeScript, not Java. This is a browser driver and a JSON contract, not a ledger. Java/Spring (or AWS around it) would not make replay more correct; it would add build surface for the same locators and the same artifact. Playwright’s a11y API is the short path for headed demo and `getByLabel` / `getByRole`. We would pick Java only if that were the language we write cleanly under time pressure — it was not. TypeScript + Playwright Chromium is the stack.

Accessibility locators, not CSS. The mock (`mock-app`, `127.0.0.1:3000`) stands in for a vendor CIF inquiry screen. No real bank, no real PII.

**LLM vendor.** We first tried Gemini for discovery (free tier). Completions came back 503; free processing was too slow for a multi-turn tool loop. We switched to OpenAI `chat.completions` (`gpt-4o-mini`), prepaid $5, auto-reload off. The model only chooses type/click/finish during discover. Replay never calls a vendor. If OpenAI is down tomorrow, saved capabilities still run.

**Why member lookup.** It is parameterized (`memberId` in, `savingsBalance` out), has real business outcomes (not-found, validation, app error), and does not require irreversible money movement. One vertical slice, not a bank platform.

**Trade-off.** Single process, no queue. Simpler to run and to review. The seam that would scale is the artifact file, not a fleet of workers.

## 2. Artifact schema

The artifact is `capabilities/lookup-member.v1.json`, validated by Zod `CapabilitySchema` in `src/artifact.ts`. It is not the model transcript.

| Field | Why |
|---|---|
| `apiVersion` / `id` | Version the contract; replay loads a file, not a chat. |
| `target.appId` + `entryUrl` | Name the vendor app separately from where this tenant hosts it. |
| `inputs.memberId` / `outputs.savingsBalance` | Per-run params. Discover typed `12345`; compile rewrites that literal to `bindInput: "memberId"`. |
| `steps[]` | Discriminated `type` / `click` / `extract` with a11y locators only (`label`, `role+name`, `rowheader`). |
| `checkpoint` | Page texts for success, `NOT_FOUND`, validation, and app error. |
| `locatorStrategy` | Written intent: operate the way an operator or screen reader would. |

`compileCapability` is the compiler: recorded actions in, reviewable JSON out. `test:artifact` asserts `12345` does not stay baked into the steps.

## 3. Determinism & error handling

Replay walks the saved steps. Same locators, `withRetry` (3 attempts) on transient misses, `waitForLoadState("domcontentloaded")` after click. After Search, `checkpoint()` classifies the body text.

| Result | Kind | Example |
|---|---|---|
| success + `savingsBalance` | success | `--member 12345` → `$1,240.55`; `12346` → `$88.12` |
| `NOT_FOUND` | business | `--member 99999` |
| `VALIDATION_ERROR` | business | `--member EMPTY` |
| `APP_ERROR` | business | `--member 00000` |
| missing control / unknown page | hard failure | `--broken` → `outcome=failed` + `evidence/replay-failure.png` |

Business outcomes exit 0. Hard failures record `step`, `expected`, `observed`, screenshot, exit 1. That is the taxonomy the brief asked for: known business result vs recoverable retry vs stop-and-debug.

UI drift shows up as checkpoint `unknown` or a locator timeout — not as a guessed balance.

## 4. Heterogeneity & multi-tenant

Not implemented. The schema is shaped so we are not stuck on this one HTML mock.

**Surface.** The recorded flow is locators + bindings. Playwright is one adapter (`getByLabel` / `getByRole`). A desktop adapter would implement the same `LocatorSchema` against an a11y tree. CSS ids never enter the artifact, so a restyled tenant page or a thick-client skin does not force a rewrite of the capability — only of the adapter.

**Multi-tenant reuse.** Hundreds of credit unions on the same vendor app share `appId` and `steps`. Tenant differences belong in `entryUrl` and, if needed, a later overlay (checkpoint phrasing, extra required field). Inputs stay parameters: the same artifact looks up Jordan Hale or Riley Chen. Per-tenant re-recording is the failure mode we are avoiding.

**Drift.** If a tenant upgrades the vendor build and Search no longer lands on “Savings balance” / “Record not found”, checkpoint returns `unknown` and we screenshot. That is the detect signal. Specialization would be a small overlay file, not a second discover, unless the overlay keeps failing.

## 5. Escalation & handoff

**Stuck (what we detect today).** Retries exhausted on a locator; checkpoint `unknown` after Search; `--broken` missing control; policy block (e.g. Transfer). Those stop the run and write evidence. They do **not** yet auto-open a live handoff mid-`npm run replay`. That wiring is the obvious next step; we did not pretend it exists.

**Live take-over.** `npm run handoff` uses the same Chromium page. Agent types Member ID `12345`, writes `evidence/intervention.json` + `handoff-before.png` (goal, step, reason, url), sets `controller=human`. The operator clicks **Search** on that window.

**Hand-back.** Enter in the terminal. Clicks are recorded in Node via `exposeFunction` (an in-page `window` array died on the form navigation to `member.html`). Then `controller=agent`, extract savings balance, write `evidence/handoff.json` + `handoff-after.png`.

Live result: `humanActions=[{"tag":"BUTTON","name":"Search",...}]`, `savingsBalance=$1,240.55`.

The W8 demo is a planned pause before Search so the transfer is visible. The intervention record is the same shape we would write when replay actually stuck.

## 6. Safety

Committed `policy.json`, enforced on discover and replay before Playwright moves.

- **Origin allowlist** — only `http://127.0.0.1:3000`. Off-origin navigation throws.
- **Allowed actions** — `type`, `click`, `extract`. No download, no file upload, no arbitrary JS.
- **Blocked controls** — Transfer, Submit wire, Delete member, Approve, Confirm transfer. Name match, case-insensitive, before click.
- **Sensitive fields** — labels matching password / ssn / pin / token / secret / credential: typing is blocked; logs show `[redacted]`. Member IDs are not secrets.

Limits: the mock has no real transfer rail, so the irreversible list is a fixture we test (`npm run test:policy`) rather than a live core-banking deny. Matching is by accessible name, not by pixel. We do not send page HTML or balances to the model on replay (replay has no model). Discover sends an a11y snapshot of the mock only; `.env` is gitignored.

## 7. Cuts

Left out on purpose:

- **Second tenant / second website** — Section 3.7 is a design story (heading 4), not a second mock.
- **Desktop runtime** — same locator schema; no Win32/AX adapter.
- **AWS, queues, cron, multi-tenant plumbing** — the artifact file is the scale seam.
- **Slack / mobile alert** — not a live-session handoff.
- **Login, transfer, wire** — irreversible UX we refuse to demo on a toy rail.
- **Auto-escalate from replay** — detect + evidence exist; mid-run HITL is the W8 CLI, not hooked to every hard fail.
- **Gemini** — abandoned after 503s; OpenAI is the discover client.
- **Screen recording** — optional in the brief; `/evidence` logs + screenshots are the pack.

Next with more time: on hard fail, write intervention and `waitForHumanResume` on the **same** replay page; tenant overlay (`entryUrl` + checkpoint) without re-discover; N-replay stability count.
