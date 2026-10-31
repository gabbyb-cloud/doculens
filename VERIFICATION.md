# Verification report

Run on 2026-10-29 in a Linux container, Node 22.

## Verified (observed directly)

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `vitest run` | 6 files, **148 / 148 passed** |
| `vite build` | succeeded; bundle contains no `ANTHROPIC_API_KEY`, `x-api-key`, `api.anthropic.com` or `sk-` strings |
| Real server, no key | `/api/health` → `llmConfigured:false`; `/api/extract` → 503; foreign Host → 403; 300 KB body → 413 |
| Production build served by Express | strict CSP header present; **zero console errors/CSP violations** in headless Chromium |
| Browser flow (Chromium) | sample → extract → valid → Export downloaded a JSON file matching the schema; invalid sample disables export; manual date fix → "Valid · 3 warnings" |
| Demo mode network use | 0 network requests during extraction |
| Input limits | textarea capped at 20,000 chars (25k paste → 20,000); PDF upload rejected with message; oversize/binary files rejected (unit tests) |
| Responsive | 390 px viewport: no horizontal page overflow (a real overflow bug was found and fixed during this run) |
| Test sensitivity | Two deliberate regressions (removing the due-date rule; leaking the key in `/api/health`) each made a test fail; code restored |

Test coverage by the three required categories: **valid** (schema, both extractor layouts, export), **invalid** (bad dates, negatives, limits, PDF/binary, bad requests), **malformed extraction results** (null/array/wrong-typed/NaN/prototype-pollution payloads at schema, draft, server and UI level).

## NOT verified

- **A successful real LLM extraction has not been run. AI mode must not be considered operational.** No valid API key was available.
- What was observed: with a deliberately fake key, the server reached the provider and received **HTTP 401**; the UI showed that error and did not claim success. This shows the failure path and that the request is routed to the provider, but says nothing about the success path (response format, prompt quality, extraction accuracy).
- The default model id `claude-sonnet-5-5` was not confirmed against a live account; set `DOCULENS_MODEL` if needed.
- LLM client logic (request shape, fence/prose JSON parsing, timeout, error mapping) is tested only against a mocked `fetch`.
- Demo extractor accuracy was tested on the 3 synthetic samples and unit cases only, not on a broad corpus.
- Not tested: Safari/Firefox, screen readers (labels/ARIA are in place but unaudited), load/concurrency, Windows/macOS.

## Fixed during verification

1. `parseMoney("12 34")` returned 1234 (whitespace glued into the number) — now rejected.
2. Mobile page overflowed horizontally due to a visually-hidden table header label — fixed.
