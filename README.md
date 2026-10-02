# Computer-use automation (interface.ai take-home)

LLM discovers a member-inquiry task once; a typed capability artifact replays it with no model. Local mock CIF only — no real bank, no real PII.

- Design: [`REPORT.md`](REPORT.md) (seven required headings)
- Evidence: [`evidence/`](evidence/) (artifact + discover log + replay success + exceptional replays + handoff)

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Put `OPENAI_API_KEY=` in `.env` (no quotes). Needed **only** for `npm run discover`. Prepaid OpenAI credits; we used `gpt-4o-mini`. `.env` is gitignored.

The “bank” is this repo’s mock. In a second terminal:

```bash
npm run mock
```

Serves `http://127.0.0.1:3000`. No other network services.

## Run without live LLM / vendor APIs

Mock up, then any of these — no API key:

```bash
npm run replay -- --member 12345
npm run replay -- --member 99999
npm run replay -- --member 12345 --broken
npm run test:artifact
npm run test:policy
```

A committed artifact is already in `capabilities/lookup-member.v1.json`. Reviewers can skip discover.

## Demo path

Keep the mock running.

```bash
npm run discover
```

Default goal: look up member `12345` and read the savings balance. Writes `capabilities/lookup-member.v1.json`.

```bash
npm run replay -- --member 12345
```

Expect `savingsBalance=$1,240.55`. No model on this path.

## W1 — mock app

```bash
npm run mock
```

Open [http://localhost:3000](http://localhost:3000).

- Member ID `12345` → Jordan Hale, savings balance `$1,240.55`
- Member ID `12346` → Riley Chen, savings balance `$88.12`
- Member ID `99999` (or anything else) → **Record not found**

## W2 — Playwright smoke (no LLM)

Keep the mock running, then in another terminal:

```bash
npm install
npx playwright install chromium
npm run smoke
```

Expect a Chromium window to open, type `12345`, click Search, then print `savingsBalance=$1,240.55`.

Headless: `HEADLESS=1 npm run smoke`.

## OpenAI API key (for W3)

Vendor is our call. We use the OpenAI API (`gpt-4o-mini`) so discovery is a real tool-calling run. Buy **$5** prepaid credits and turn **off auto-reload**.

1. Billing: [platform.openai.com/settings/organization/billing](https://platform.openai.com/settings/organization/billing/)
2. Key: [platform.openai.com/api-keys](https://platform.openai.com/api-keys) — use a **new** key if an old one was exposed.
3. In `.env` (no quotes, no braces):

```
OPENAI_API_KEY=sk-your-key-here
```

`.env` is gitignored. Do not commit it, and do not paste the key into chat or the README. You can delete any `GEMINI_API_KEY` line; we do not read it anymore.

## W3 — LLM discovery

Keep the mock running. Key must be in `.env`.

```bash
npm run discover
```

Or a custom goal:

```bash
npm run discover -- "Look up member 12345 and read their current savings balance"
```

Chromium opens. OpenAI observes the accessibility tree and chooses type/click until it reads a balance or not-found.

Headless: `HEADLESS=1 npm run discover`.

## W4 — capability artifact

A successful discover writes `capabilities/lookup-member.v1.json`. That file is the reusable contract (steps, locators, `memberId` input, `savingsBalance` output, checkpoint). It is **not** the OpenAI transcript.

Open it and confirm `12345` was turned into `bindInput: "memberId"`. Replay (W5) will use this file with no model.

## W5 — deterministic replay (no LLM)

Keep the mock running. No API key.

```bash
npm run replay -- --member 12345
```

Expect `savingsBalance=$1,240.55`.

```bash
npm run replay -- --member 99999
```

Expect `outcome=NOT_FOUND`. That is a business result, not a crash.

## W6 — tighter runtime outcomes

Same replay, no LLM. After Search we classify the page:

| Command | Kind | Expect |
|---|---|---|
| `--member 12345` | success | `savingsBalance=$1,240.55` |
| `--member 99999` | business | `outcome=NOT_FOUND` |
| `--member EMPTY` | business | `outcome=VALIDATION_ERROR` |
| `--member 00000` | business | `outcome=APP_ERROR` |
| `--member 12345 --broken` | hard failure | `outcome=failed` + `evidence/replay-failure.png` |

`--broken` is an injected missing control (extract a row that does not exist). Clicks/types retry a few times for transient slowness.

Headless: `HEADLESS=1 npm run replay -- --member 12345`.

## W7 — safety policy

Committed `policy.json` is enforced on every type/click/extract (discover and replay):

- **Origin allowlist** — only `http://127.0.0.1:3000`
- **Allowed actions** — type, click, extract
- **Blocked controls** — Transfer, Submit wire, Delete member, Approve (irreversible; we never click them)
- **Redaction** — labels matching password/ssn/pin/token are logged as `[redacted]`

```bash
npm run test:policy
```

Expect `policy ok`. A click named `Transfer` throws before Playwright moves.

## W8 — same-session human handoff

No full operator console. Agent types the member id, pauses, you use **that** Chromium, then press Enter.

Mock must be running. Use a real terminal (so Enter works):

```bash
npm run handoff
```

1. Chromium opens; Member ID is already `12345`.
2. Click **Search** yourself.
3. Back in the terminal, press **Enter**.
4. Agent extracts the balance and writes `evidence/intervention.json` + `evidence/handoff.json`.

Expect `controller=human` then `controller=agent` and `savingsBalance=$1,240.55`.

## Evidence (`/evidence`)

| File | What it shows |
|---|---|
| `lookup-member.v1.json` | Saved capability (copy of `capabilities/`) |
| `discover.log` | Live OpenAI discover → `$1,240.55` |
| `replay-12345.log` | Happy replay |
| `replay-99999.log` | Business `NOT_FOUND` |
| `replay-EMPTY.log` | Business `VALIDATION_ERROR` |
| `replay-00000.log` | Business `APP_ERROR` |
| `replay-broken.log` + `replay-failure.png` | Injected hard fail + screenshot |
| `handoff.log` + `intervention.json` + `handoff.json` + before/after PNGs | Same-session human Search, then `$1,240.55` |

Optional: `npm run evidence` recopies the artifact (mock must be up). Discover/handoff logs stay as the live runs.


