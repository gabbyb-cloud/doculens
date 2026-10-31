# DocuLens

Extract structured invoice data from **plain-text** documents, check it against a strict schema, correct it by hand, and export validated JSON.

Built with React, TypeScript, Vite, Node.js (Express) and Zod. All sample documents are synthetic.

## What it does

- Upload a `.txt` file or paste text (max 20,000 characters / 100 KB).
- Extracts invoice number, invoice/due dates, vendor, currency, line items, subtotal, tax and total.
- Shows the source document beside an **editable** results form, re-validated on every keystroke.
- Exports JSON **only** when the data passes the Zod schema.
- Two extraction modes:

| Mode | How it works | Needs |
|---|---|---|
| **Demo** (default) | Deterministic rule-based parser (regex). **Not AI.** Runs in the browser; no network calls. | nothing |
| **AI** (optional) | Local Node server calls an LLM with a server-side key. Output is treated as untrusted and validated. | `ANTHROPIC_API_KEY` |

## Quick start

Requires Node 20.12+.

```bash
npm ci
npm run dev          # web: http://localhost:5173  (API on 127.0.0.1:8787)
npm test             # 148 tests
npm run build && npm start   # production: one server on http://127.0.0.1:8787
```

Enable AI mode (optional): copy `.env.example` to `.env`, set `ANTHROPIC_API_KEY`, restart. The key is read only by the server and is never sent to the browser. **AI mode sends document text to the model provider**; the UI says so.

## Design decisions

- **Validation is the gate.** Demo output, model output and manual edits all pass through one Zod schema (`shared/schema.ts`). Export accepts only validated data.
- **Schema errors block; arithmetic mismatches warn.** Real invoices have discounts and rounding, so line/subtotal/total mismatches are flagged but do not block export, and are recorded in the export.
- **Model output is untrusted.** The server validates it and reports issues; the browser validates again and never trusts the server's verdict.
- **Demo mode never guesses.** Missing fields come back `null` and show up as validation errors.
- **Security:** key is server-only; request size limit (128 KB); per-IP rate limit on `/api/extract`; Host-header allowlist (DNS-rebinding guard); binds to `127.0.0.1`; strict CSP on the built app; submitted text is never echoed in errors or logged.

## Layout

```
shared/   schema, demo extractor, limits, samples (used by browser and server)
server/   Express app, LLM client
src/      React UI
tests/    Vitest suites (schema, extractor, LLM client, server, draft/export, UI)
```

## Known limitations

- Plain text only. **No PDF or OCR support.**
- Demo parser handles common labels/layouts, not arbitrary invoices. `$` is assumed to mean USD; `MM/DD/YYYY` is assumed for ambiguous slash dates; European number formats (`1.234,56`) are not supported.
- Single invoice per document; negative amounts (credit notes) are rejected.
- Rate limiting is in-memory and per-process; no authentication. Intended for local use, not public hosting.
- **AI mode has not been verified against a successful real model call** — see `VERIFICATION.md`.

## License and reuse

Copyright © 2026 Gabriell Bedoy. All rights reserved.

DocuLens is made available publicly for portfolio review and technical evaluation. No open-source license is granted for the original project code.

Except as permitted by applicable law or platform terms, copying, modifying, redistributing, sublicensing, or commercially reusing the original project code requires prior permission from the copyright holder.

Third-party dependencies and other third-party material retain their respective licenses. For licensing or reuse inquiries, contact the repository owner through GitHub.
