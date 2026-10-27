# Agent evaluation (2026-10-27)

How well does the reconciliation agent pick the purchase order and map invoice lines with real Claude, and what did measuring it change? Every number below comes from a recorded run in `evals/results/agent-bench/` or from the Langfuse API (`evals/results/agent-bench-langfuse.json`). Total spend for the whole study: **$2.23** of a $3 cap.

## Summary

| | Baseline (Haiku 5.5, prompt v1) | Final (Haiku 5.5, prompt v3) | Change |
|---|---|---|---|
| PO selection accuracy (test split) | 92.9 % | **100 %** | +7.1 pt |
| Wrong picks (picked a PO that is not the right one) | 0 % | **0 %** | — |
| Exact runs (right PO and every line mapped as labeled), all 180 runs | 94.4 % | **100 %** | +5.6 pt |
| Line mapping F1 | 0.974 | **1.000** | +0.026 |
| Agreement across 5 repetitions | 1.000 | 1.000 | — |
| Cost per run (app ledger) | $0.00109 | **$0.00078** | −28 % |
| Latency per run, p50 / p95 (Langfuse root spans) | 6.16 s / 8.77 s | **4.08 s / 6.27 s** | −34 % / −28 % |
| Model calls per run (ledger) | 2.82 | **2.15** | −24 % |

The improvement came from fixing a **tool limitation** found by the benchmark, plus one missing rule in the instructions, not from tuning wording. Claude Sonnet 5.5 was compared on the same cases. It was not more accurate. It made the only real judgment error in the study (selecting a closed PO, which the workflow's deterministic guard rejected). It cost about 19× more per run.

**Caveat:** the final version scores 180/180, so this benchmark is now **saturated**. It can no longer tell a better agent from an equal one. The next step is harder cases (see the end of this page).

## What was measured

**Benchmark.** 36 labeled cases on a separate synthetic catalog (6 suppliers, 24 POs), split 18 dev / 18 test (`data/agent-bench/`). The public demo data is untouched. Each label gives the expected PO (or none) and the expected PO line for every invoice line. The loader rejects any label that points outside the supplier's open POs.

| Category | Cases | What it tests |
|---|---|---|
| search | 16 | No reference: synonyms, abbreviations, English vs Spanish descriptions, reordered lines, partial invoices, an extra charge line, near-duplicate POs that only quantities tell apart |
| abstain | 6 | Identical candidate POs, only a closed PO fits, nothing plausible, a single unrelated open PO. The right answer is no PO |
| fixed-po | 8 | The invoice references an existing PO; the agent only maps lines (reordered, similar items, cross-language, extra line, partial) |
| many-candidates | 3 | A supplier with 7 open POs, where the tool returns at most 5 per call |
| bad-reference | 2 | A reference that does not exist (`PO-K-1O3` with a letter O, `PO-F-22`) |
| injection | 1 | A line description tells the agent to pick another PO with HIGH confidence |

**Execution.** Each run goes through the real workflow: Zod validation, Postgres persistence, the Mastra agent with its two DB-backed tools, the deterministic rules and the review gate. It runs on a scratch database (`npm run eval:bench`). The score compares what the workflow kept, not the raw model text. So a PO the workflow rejects as invalid counts as a wrong pick.

**Metrics** (`evals/agent-bench/score.ts`, unit-tested):

- *PO accuracy*: the selected PO equals the label (no PO counts as correct when none is expected).
- *Wrong pick*: a PO was selected and it is not the labeled one. This includes a PO the workflow rejects. It is the error that matters most.
- *Over-abstention*: no PO selected although one was expected. Safe, but it costs a human review.
- *Errors*: the run ended `FAILED` for another reason (for example invalid output).
- *Line precision / recall / F1*: over (invoice line → PO line) pairs, end to end.
- *Exact*: right PO and every line exactly as labeled.
- *Agreement*: share of repetitions that match the most frequent decision.

Fixed-PO cases have no PO verdict and only count for line metrics.

**Rules for changes.** Changes had to be general (tool, instructions, parsing), never tied to a case. They were motivated only by **dev** failures, and the **test** split is the headline. Every change was re-run on all cases.

## Iterations

| Run | Model | Prompt | Runs | PO acc. test | Wrong picks | Errors | Exact | Ledger $ |
|---|---|---|---|---|---|---|---|---|
| `haiku-v1-baseline` | Haiku 5.5 | v1 | 36 × 5 | 92.9 % | 0 % | 0 % | 94.4 % | 0.196 |
| `haiku-v2-dev` | Haiku 5.5 | v2 | 18 dev × 3 | — | 0 % | 0 % | 100 % | 0.042 |
| `haiku-v2-final` | Haiku 5.5 | v2 | 36 × 5 | 98.6 % | 0 % | 1.1 % | 98.9 % | 0.148 |
| `sonnet-v2-final` | Sonnet 5.5 | v2 | 36 × 3 | 100 % | 3.6 % (dev) | 0 % | 97.2 % | 1.629 |
| `sonnet-v3-a03` | Sonnet 5.5 | v3 | A03 × 3 | — | 0 % | 0 % | 100 % | 0.065 |
| `haiku-v3-final` | Haiku 5.5 | v3 | 36 × 5 | **100 %** | **0 %** | **0 %** | **100 %** | 0.141 |

(Plus a one-case Sonnet smoke, $0.014.)

### v1 → v2: the tool hid the right answer

The baseline failed only on B17 and B18, both dev and test, 10 of 10 runs. In both, the right PO was the 6th or 7th of the supplier's open orders, and `lookupPurchaseOrders` returns at most 5 with no way to page. The traces show the agent doing the right thing with what it had. It fetched all five candidates, sometimes searched again, and then declined with LOW confidence instead of forcing a choice. That is safe, but a person still had to do the work.

Changes (v2):
1. `lookupPurchaseOrders` gets `offset`, `total` and `hasMore` (still capped at 5 per page and scoped to the supplier).
2. Each candidate now carries its lines (id, description, quantity, unit price), so the agent can screen candidates without one `getSupplierAndOrderDetails` call per order.
3. The instructions tell the agent to page while nothing fits.

Effect: many-candidates went from 33 % to 100 %. Detail calls fell from 3.1 to 0.2 per run in the Langfuse tool spans, and cost and latency each dropped by about a third.

### v2 → v3: two residual failures and one Sonnet finding

- **Malformed output (B19, dev; B20, test; 2 of 180 runs).** Both answers were right in substance. In B19 the JSON was followed by a stray `}]`. In B20 one mapping entry was duplicated under the wrong key (`lineId`). The JSON extractor now reads the first *complete* object, so the real B19 output, replayed from Langfuse, now parses. B20 is still rejected on purpose: it ends in an explicit `FAILED`, never in a guessed mapping. This fix is in parsing, not in the prompt.
- **Closed PO selected (Sonnet, A03, 3 of 3 runs).** Only the closed PO-K-099 contained the invoiced items. Sonnet called the lookup with `includeClosed: true`, picked it, and explained "PO-K-099 is CLOSED, so confidence is MEDIUM … needs review". The workflow guard rejected the selection (`FAILED`), so nothing wrong was stored. The behavior shows a gap in the contract: the instructions never said that only open POs can be selected. v3 adds that rule. Sonnet then abstained correctly in 3 of 3 runs, and Haiku stayed at 100 % on all cases.

## Haiku 5.5 vs Sonnet 5.5 (same cases, prompt v2)

| | Haiku 5.5 (v2, ×5) | Sonnet 5.5 (v2, ×3) |
|---|---|---|
| PO accuracy, all runs | 98.6 % | 96.4 % |
| Wrong picks | 0 | 3 (A03, closed PO; rejected by the guard) |
| Errors (invalid output) | 2 | 0 |
| Line F1 | 0.991 | 1.000 |
| Cost per run (ledger) | $0.00077 | $0.0151 (≈ 19×) |
| Latency p50 / p95 per run (Langfuse) | 4.27 s / 6.44 s | 4.94 s / 7.46 s |
| Output tokens per run | 673 | 509 |

Sonnet's line mapping was perfect and its output never malformed. Haiku avoided the only judgment error. After v3 both are correct on this set, so Sonnet's 19× price buys nothing measurable here. **Production stays on Haiku 5.5.** That decision should be revisited only if a harder benchmark shows a gap.

## What Langfuse shows

All runs were traced to Langfuse Cloud (environment `agent-bench`, tags `run:<label>`, `model:`, `prompt:`, `split:`, `category:`). Each trace also carries five scores: `bench_po_correct`, `bench_wrong_pick`, `bench_exact`, `bench_line_f1` and `bench_outcome`. The tables below come from `npm run eval:bench:langfuse` (Metrics API v2), not from local files.

| Run | Traces in Langfuse / local runs | Generations / ledger requests | Input tokens per trace | Output tokens per trace | Cost per trace (Langfuse prices) | Root p50 / p95 | Model call p50 |
|---|---|---|---|---|---|---|---|
| haiku-v1-baseline | 170 / 180 | 473 / 507 | 5,892 | 988 | $0.00100 | 6.16 s / 8.77 s | 2.00 s |
| haiku-v2-final | 180 / 180 | 382 / 384 | 4,332 | 672 | $0.00070 | 4.27 s / 6.44 s | 1.76 s |
| haiku-v3-final | 180 / 180 | 386 / 387 | 4,462 | 667 | $0.00073 | 4.08 s / 6.27 s | 1.79 s |
| sonnet-v2-final | 104 / 108 | 245 / 253 | 5,003 | 513 | $0.01496 | 4.94 s / 7.46 s | 1.58 s |

| Run | Tool spans: lookupPurchaseOrders | Tool spans: getSupplierAndOrderDetails | `bench_po_correct` (avg) | `bench_wrong_pick` (avg) | `bench_exact` (avg) |
|---|---|---|---|---|---|
| haiku-v1-baseline | 144 | 524 | 0.932 | 0 | 0.947 |
| haiku-v2-final | 168 | 38 | 0.986 | 0 | 0.989 |
| haiku-v3-final | 169 | 41 | **1.000** | **0** | **1.000** |
| sonnet-v2-final | 121 | 24 | 0.963 | 0.038 | 0.971 |

Readings:

- **The latency gain is fewer round trips, not faster calls.** Per-call latency moved little (2.0 s to 1.8 s). Calls per trace fell (2.8 to 2.1) because detail fetches nearly disappeared (524 down to 41).
- **The cost gain is fewer tokens.** About 24 % fewer input tokens and 33 % fewer output tokens per trace.
- **Sonnet is quicker per call (1.58 s) but slower end to end.** It reads more (5.0 k input tokens) and makes more calls per run (2.34).
- **Langfuse data quality.** The baseline is missing about 6 % of traces and generations in Langfuse. The scores posted at the same time also hit the Langfuse API rate limit (HTTP 429; the runner now backs off and retries). Later runs are complete or within 1–4 %. Langfuse's built-in price table gives about 7 % lower cost than the app's ledger, which uses list prices. The **ledger** is what enforces the spend cap.
- **Tags live on the root observation only.** Child generations and tool spans do not inherit them, so model and tool metrics are grouped by the environment and the run's exact time window. Runs never overlap.

## Limits of this study

- **Synthetic and small.** 36 cases, written by the same process that improved the agent. Even with the dev/test split, the test cases share the author's idea of what is hard. This shows the agent behaves correctly on the cases it was designed for. It is not an accuracy estimate for real invoices.
- **Saturated.** 100 % at v3 means there is no headroom left to measure.
- **Rare failures need more runs.** The malformed-output rate in v2 was 2 of 180 runs (about 1 %); v3 had 0 of 180, which does not prove the rate is zero. Structured outputs (schema-constrained generation) would remove this class instead of catching it.
- **One configuration.** Temperature 0 and the default thinking settings of the AI SDK provider, maxSteps 4. Effort and thinking settings were not swept.

## Next steps

1. **Harder benchmark** to get headroom back: OCR-style noise, more than 10 lines, quantity splits across two POs, units of measure (boxes vs pieces), several plausible POs that differ only in price, and more injection variants. Grow the test split separately from dev.
2. **Structured outputs** for the agent's final answer, then re-measure the error rate.
3. **Langfuse experiments.** Once Mastra's exporter supports the experiment attributes (`langfuse.experiment.*`), link runs to a Langfuse dataset to get the side-by-side comparison view. For now the same comparison is made with tags and scores.
4. **Run the benchmark before agent changes.** `npm run eval:bench -- --label <name> --reps 3` on Haiku costs about $0.08 for all cases.

## Reproduce

```bash
npm run eval:bench -- --label my-dryrun --mock          # free: mock model, checks the plumbing
EVAL_LIVE_CONFIRM=yes npm run eval:bench -- --label my-run --reps 5            # Haiku, about $0.14
EVAL_LIVE_CONFIRM=yes npm run eval:bench -- --label my-sonnet --reps 3 --model claude-sonnet-5-5
npm run eval:bench:langfuse -- my-run                   # metrics back from Langfuse
```

The runner refuses to spend without `EVAL_LIVE_CONFIRM=yes`. It also enforces a global cap (`EVAL_BENCH_BUDGET_USD`, default $3) over every recorded live run, and labels cannot be reused.
