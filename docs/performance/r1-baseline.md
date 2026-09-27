# R1 performance baseline

The committed `benchmarks/r1-engineering-reference.json` artifact is pre-optimization engineering evidence. It is not an approved latency, memory, throughput, convergence, or cost budget and is not an SLA.

Capture uses two warmups and five measured runs per synthetic fixture by default. `PERF_WARMUPS`, `PERF_RUNS`, and `PERF_OUTPUT` may override those values. The command records individual forecast totals, phase summaries, local Node CPU time and heap deltas where measurable, canonical model counts, horizon/version/runtime context, and the fixture coverage inventory. Local Node and browser-main execution are `not_metered`; no zero-dollar cloud cost is fabricated.

Browser-main evidence is available in `Settings > Advanced` after a forecast run. React/chart timings are profiler-dependent and display as N/A when unavailable. Server/cloud execution has no R1 adapter or provider and is recorded as `not_implemented/not_measured`; an execution-placement recommendation is deferred until approved budgets exist.

Run `npm run perf:capture` to refresh the engineering reference. The command asserts financial executability only and contains no wall-clock pass/fail threshold.
