# Simulation and orchestration guidance

These rules apply under `src/simulation/`.

- Preserve authoritative deterministic execution semantics exactly unless the
  task explicitly changes them under a higher-authority specification.
- Scheduler/concurrency implementation order is never economic precedence.
- Optimization or parallelization must demonstrate result equivalence rather
  than assume commutativity.
- Randomness must enter only through explicit seeded RandomSource/RandomStream
  abstractions; never call ambient randomness in authoritative execution.
- Stochastic realization identity and random substreams must be independent of
  worker scheduling, batching, or completion order.
- Common-random-number comparison requires explicit shared cohort identity.
- Failed, cancelled, superseded, or incomplete runs cannot replace the last
  successful result.
- High-count stochastic/convergence/performance validation belongs in the
  external engineering-validation workflow, not a Codex local turn.
