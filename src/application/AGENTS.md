# Application-layer guidance

These rules apply under `src/application/`.

- Application code may orchestrate engine/simulation capabilities but must not
  redefine financial semantics owned by lower layers.
- Calculation/result cache keys must be application-owned deterministic
  fingerprints of every authoritative input that affects the result.
- A cache hit must never make a result appear current after authoritative
  inputs, execution configuration, calibration, tax basis, or applicable
  versions change.
- Long-running work must have explicit request identity. Superseded responses
  must be discarded without evicting the last valid committed result.
- Worker/off-main-thread transport must preserve deterministic request/result
  identity and explicit serialization boundaries.
- Cancellation, stale state, errors, and unsupported/incomplete capability
  states are distinct; do not collapse them into a generic failure.
- Current-state snapshots must not silently invoke a long-horizon forecast.
- Saved plan/configuration is durable input; derived deterministic/stochastic
  result data is separately versioned/discardable.
- Do not add network/provider coupling to engine-facing contracts.
