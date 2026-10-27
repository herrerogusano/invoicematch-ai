# Evaluation

Two separate things are measured. They are never mixed.

## 1. Offline deterministic evaluation (`npm run eval:offline`)

- 16 versioned, labeled synthetic scenarios in `data/fixtures/scenarios.json` (version 1).
- Each scenario runs through the **real** Mastra workflow, the **real** agent loop and the **real** tools against a scratch local Postgres database. Only the language model is replaced by a scripted mock (`invoicematch-mock-v1`, `src/mastra/mock-model.ts`): a transparent heuristic (token overlap + equal price/quantity) that is **not an LLM**.
- Scoring: exact expected status **and** exact multiset of rule IDs. Results in `evals/results/latest.json`.

**Result (2026-10-15): 16 / 16 passed.**

| Scenario | Expected status | Expected rule IDs | Agent invoked |
|---|---|---|---|
| S01 exact match | MATCHED | — | no |
| S02 quantity mismatch | REVIEW_REQUIRED | LINE_QUANTITY_MISMATCH, TOTAL_VS_PO_MISMATCH | no |
| S03 unit price mismatch | REVIEW_REQUIRED | LINE_UNIT_PRICE_MISMATCH, TOTAL_VS_PO_MISMATCH | no |
| S04 missing line | REVIEW_REQUIRED | LINE_MISSING_ON_INVOICE, TOTAL_VS_PO_MISMATCH | no |
| S05 extra line | REVIEW_REQUIRED | LINE_UNMATCHED_INVOICE, TOTAL_VS_PO_MISMATCH | no |
| S06 wrong supplier | REVIEW_REQUIRED | SUPPLIER_MISMATCH | no |
| S07 wrong currency | REVIEW_REQUIRED | CURRENCY_MISMATCH | no |
| S08 duplicate invoice | REVIEW_REQUIRED | DUPLICATE_INVOICE | no |
| S09 incorrect tax | REVIEW_REQUIRED | LINE_TAX_RATE_MISMATCH, TOTAL_VS_PO_MISMATCH | no |
| S10 incorrect declared total | REVIEW_REQUIRED | INV_TOTAL_ARITHMETIC | no |
| S11 unknown PO | UNMATCHED | PO_NOT_FOUND | no (zero candidates) |
| S12 ambiguous candidates | UNMATCHED | LOW_AGENT_CONFIDENCE, PO_AMBIGUOUS | yes (mock) |
| S13 PO selected by the agent | REVIEW_REQUIRED | PO_SELECTED_BY_AGENT, LINE_SEMANTIC_MAPPING ×2 | yes (mock) |
| S14 closed PO | REVIEW_REQUIRED | PO_CLOSED | no |
| S15 inconsistent printed line | REVIEW_REQUIRED | INV_LINE_ARITHMETIC | no |
| S16 semantic line mapping | REVIEW_REQUIRED | LINE_SEMANTIC_MAPPING ×3 | yes (mock) |

What this proves: the deterministic rules, the workflow wiring, the tool calls and the persistence produce exactly the labeled outcomes. What it does **not** prove: anything about Claude's selection quality. The mock's choices are scripted.

## 2. Critical-path tests

| # | MASTER_PLAN §8 critical path | Test | Result |
|---|---|---|---|
| 1 | Exact match → MATCHED, zero delta, no approval | `workflow.test.ts` "exact match" | PASS |
| 2 | Qty/price/tax mismatch → precise finding + REVIEW_REQUIRED persisted | `workflow.test.ts` "quantity mismatch", unit tests | PASS |
| 3 | No PO + two plausible POs → no false certain match | `workflow.test.ts` "no PO + two plausible POs" | PASS |
| 4 | Inconsistent declared total → deterministic finding | `reconcile.test.ts`, S10, S15 | PASS |
| 5 | Same invoice twice → no duplicate side effects/approvals | `workflow.test.ts` idempotency + duplicate tests, `api-security.test.ts` | PASS |
| 6 | Concurrent review actions → one terminal decision | `workflow.test.ts` "concurrent review actions" (5 parallel) | PASS |
| 7 | Suspend, reload in a separate process, approve and reject | `restart.test.ts` (5 distinct PIDs); manual HTTP run across a dev→prod server restart | PASS |
| 8 | Anonymous POST to run/review → 401/403 with zero LLM calls | `api-security.test.ts` (counting model = 0) | PASS |
| 9 | Model outage / rate limit → explicit state, no fake match | `agent-failures.test.ts` (529, 429, invalid JSON, hallucinated id, no key, budget 0) | PASS |
| 10 | Synthetic-only data, sanitized tracing, no secrets | `npm run check:secrets`, `tracing.test.ts` secret assertions | PASS |

Totals on 2026-10-15: unit 34/34, integration 29/29 (two consecutive full runs). One earlier run of `api-security.test.ts` ended with a native Windows worker exit (0xC0000409) before any assertion; the same file passed in every later run (individually and in full suites). Recorded as an open flakiness item, not hidden.

## 3. Live LLM smoke (`npm run eval:live`)

**Status: 3 / 3 PASS on 2026-10-21** with `claude-haiku-5-5` (`evals/results/live-latest.json`). Usage was 8 requests at an estimated $0.0028, recorded by the budget ledger.

| Scenario | Status (expected) | Rule IDs | Tool calls |
|---|---|---|---|
| S12 ambiguous candidates | UNMATCHED (UNMATCHED) | LOW_AGENT_CONFIDENCE, PO_AMBIGUOUS | lookupPurchaseOrders, getSupplierAndOrderDetails ×3 |
| S13 agent-selected PO | REVIEW_REQUIRED (REVIEW_REQUIRED) | LINE_SEMANTIC_MAPPING ×2, PO_SELECTED_BY_AGENT | lookupPurchaseOrders, getSupplierAndOrderDetails |
| S16 semantic line mapping | REVIEW_REQUIRED (REVIEW_REQUIRED) | LINE_SEMANTIC_MAPPING ×3 | getSupplierAndOrderDetails |

In S12 the model inspected all three candidate POs and declined to choose. This is the behavior the scenario guards against getting wrong.

`EVAL_LIVE_CONFIRM=yes npm run eval:live` runs only S12, S13 and S16, the agent-dependent scenarios. It uses `AGENT_MODE=anthropic` inside the budget ledger. It writes `evals/results/live-latest.json` with the model id, tool calls and usage. A difference from the label is reported as a qualitative LLM-selection signal (`DIFF`), not as a rule failure. This is a single small sample, not a statistical accuracy claim.

## 4. Agent benchmark with Claude (`npm run eval:bench`)

36 labeled agent cases (PO selection and line mapping) on a separate synthetic catalog, dev/test split, repeated runs, scores in Langfuse. On 2026-10-27 it moved Haiku 5.5 from 92.9 % to **100 %** PO accuracy on the test split with **0 wrong picks**, and cut cost per run by 28 % and p50 latency by 34 %. Sonnet 5.5 was compared and not adopted. Full study, Langfuse metrics and limits: [agent-evaluation.md](agent-evaluation.md).

## 5. Tracing

- Instrumentation: VERIFIED offline. `tracing.test.ts` asserts spans of type `workflow_run`, `agent_run`, `model_generation` and `tool_call` (both tools) under one trace id equal to the one stored on the reconciliation, with the reconciliation id in metadata and no secret patterns in span payloads.
- Delivery to Langfuse Cloud: VERIFIED 2026-10-15: `npm run check:langfuse` ran a mock S13 reconciliation and found the full trace in Langfuse Cloud EU via the v2 observations API (22 observations: workflow, steps, agent, 2 model generations, `lookupPurchaseOrders` and `getSupplierAndOrderDetails`). Organizations created on or after 2026-09-16 get HTTP 410 from the legacy `/api/public/traces` and `/api/public/observations` endpoints; use `/api/public/v2/observations`. With keys, the exporter is registered automatically and the owner page links `LANGFUSE_PROJECT_URL/traces/<traceId>`.