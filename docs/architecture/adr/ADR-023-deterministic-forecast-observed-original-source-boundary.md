# ADR-023: Observed original-source validity for deterministic forecasts

- Status: Accepted — product-manager decision 2026-11-18; effective in controlled repository on merge
- Date: 2026-11-18
- Owner: D2-D #149 / producer-consumer source-history prerequisite #348
- Requirement: PFA-DET-023, PFA-DET-015–022, PFA-PERF-018/021
- Does not supersede ADR-021 financial posting sequence or proposed ADR-022 retirement publisher protocol

## Context

Supported deterministic forecasting composes independently sourced S1 BANK permissions, HELOC issuer servicing, fixed-loan lender service, FSA, card, SSA and (in the supported single occurrence) funded retirement original facts. The current HELOC source ports each offer a separate `read`: issuer original and BANK debit. This permits independent reconstruction of B1 actual interest/principal/claims and the bank journal, but supplies **no coordinated snapshot across the two publishers**.

A concrete counterexample: the issuer read for January returns the authorized original. During the final BANK read, the BANK publisher returns the still-valid original and independently revokes the issuer's original before its call returns. The successful final observation values and journal are identical to a world with no issuer revocation. In the first world, however, the issuer original is no longer live when the forecast result is delivered. Reversing read order moves the gap to BANK; any finite retry has a last read. Source-hash equality and an attempt-scoped cache prove neither cross-publisher live completeness nor durability at delivery.

The old #348 contract mistakenly promised independent at-delivery currentness of *all* sources, which cannot be shown with these existing ports. The PM explicitly approved **bounded final-observation validity only for deterministic forecasts** on 2026-11-18. The separately approved legacy HELOC 66/276 cumulative-checkpoint bytes exception concerns computational cost and does not solve this consistency limitation.

## Decision

**A. Named strength: source-observed deterministic evidence.** A forecast result may claim independent publisher-original qualification at each actually observed read instant, bound to run/scenario/asOf/dataCutoff/source identities and tested against actual canonical posting, claim, journal, payment and archive facts. It may not claim a common atomic source revision, continuous source freshness, or live validity at the time of delivery. Existing local simulated accounting commits remain atomic and source-qualified against independently observed selected originals; they are *not* external bank settlements or real-world authorization to execute a transaction.

**B. Current selected event.** Keep the original/source and BANK independently read and requalified before/after the actual selected canonical writer where applicable, with ownership, amounts, rules, date, order, permission, fraud, funding, ledger and identity checks. A speculative candidate or observer cannot convert a stale point-read token or old publisher digest into a current authority. Detect/reject changes actually observable by the source's read; do not claim to detect an issuer revocation that occurs after its own last read while BANK is still reading.

**C. Outward boundary.** For full and incomplete forecast results, standalone VS4 and frozen reference, replay-window release, portable exports/checkpoints, application read-model/worker packaging and explicitly exposed callbacks, perform a final independent admission of the *complete committed* source history and corresponding journal/proofs. Place the check as close as possible to **each actual emission**: before handing out source-qualified state or proof to callback, after callbacks/serialization with effects that can alter source originals, and before returning the completed outward artifact. An externally exposed callback is an observable output even when the engine also returns a final result. The built-in checkpoint retention collectors are not themselves external emissions, but their separately exported materializations are. Recheck newly observed changes or withdrawals even for a legitimately incomplete February result with January committed. If such source qualification fails, do not return a falsely current source-qualified prefix or an artifact claiming successful source admission; preserve the pre-candidate committed state and an explicit incomplete/error outcome.

A final pass always has a last read. **Qualify as observed**, never as jointly current at response delivery; repeating the pass does not create atomicity. For many externally exposed per-period custom observers, a separate observation is needed for each observable emission. Such streaming may have superlinear read costs and is outside the ordinary single-final-result 1/12/24 proportional benchmark. Do not silently promote untrusted participant IDs into privileged internal collectors, or use a consumer hash/frozen clone as publisher authority.

**D. Replay and archival proof.** Cold and warm restore, sparse checkpoints, terminal-only deltas, replay windows and application/worker export must independently bind the full actual committed history to selected sources and canonical BANK/journal/claim/identity proofs. A still-matching closing balance, frozen original bytes, fresh-looking digest, private in-memory index, or retained terminal state cannot substitute for the missing earlier original. An absent/withdrawn original **when independently observed** fails closed. Old portable artifacts remain readable under their existing source-qualification requirements; they do not become live publisher snapshots.

**E. Unsupported higher-strength promises.** A live external financial action, two-source simultaneous revocation guarantee, publish-at-one-atomic-instant API, or repeatedly source-current funded retirement protocol needs a real publisher-owned coordination guarantee (atomic revision fence, conditional commit or another explicitly approved mechanism), with complete independently authenticated provenance. Do not add a time lease, silently weaken existing action authorization, change tax/law logic, or infer source authority from a bare revision string. Proposed ADR-022 for #350 is a separate stronger, publisher-specific architecture under review and **is not** a shared issuer/BANK atomic transaction.

## Proof and acceptance table

| Observation / path | Required source observation | Accepted claim | Mandatory negative |
| --- | --- | --- | --- |
| Selected HELOC and fixed-loan current principal/interest/debit, required and extra | Independent current issuer/lender + BANK at the actual canonical simulated posting, required before/after selected writer checks | Sources observed separately; canonical posted and balanced | Source withdrawn/changed before its own check; wrong authority/BANK/owner/amount/claim; rollback |
| FSA/card/SSA native claims and single supported retirement | Independent plan/issuer and BANK sources at selected writer, complete records/journal | Exact independently observed and source-backed economic truth | Omitted/duplicated/falsified old source, changed evidence before own read |
| Household summary/detail completed and incomplete | Full committed-history final observation; private retention only used internally | Qualified at each observed final read | January withdrawn before January's final read, even if February fails |
| Externally accessible prepare/execute/observe and performance callbacks | Validate before actual source-qualified state/proof exposure and again at final result boundary after callback effects | Per-output observation, no permanent currentness | Callback mutation observed on later check; reject public stale claim |
| Standalone VS4, frozen reference, direct/prepared, required-only and optional-extra | Explicit full/incomplete result observation and actual selected lender/BANK sources | Independent selected and release observations | January withdrawal before January's own read on failed February exit |
| Cold/warm/sparse/terminal archive, application/worker packaging and replay window | Full independent original+receipt+posting+claim inventory and last observation before outward emission | Replay evidence observed during that request | Missing terminal-only source and forged closing BANK balance |
| Cross-publisher interleaving counterexample | Issuer read returns valid; issuer revoked inside later BANK read after issuer's read | **No joint at-delivery guarantee claimed**, even if independent pass succeeds | Test must NOT assert detection of an intrinsically unobservable interleaving |

## Consequences and constraints

- Keep #348's 11-path bounded production grant and independent test subtree; no HELOC `source.ts`, B1 issuer contract, new publisher authority, or retirement-port change is authorized for #348.
- Proportionality for ordinary final-only runs continues to exclude intrinsic legacy HELOC issuer cumulative bytes while still measuring unavoidable B1 checks and all avoidable repeated publisher/history work. Per-callback streaming cost must be reported honestly and may grow superlinearly.
- Distinguish *publisher-observed original evidence*, *complete structural/journal replay validity*, and a *simultaneous live authorization snapshot*. Only the first two are in scope for legacy deterministic forecasts.
- Do not broaden this decision to actual external financial actions, settlement execution by a provider, order placement or an API explicitly promising live jointly current sources.
- #331 remains test-only and blocked on #348's exact-head independent audit/merge. #149 final D2 integration, #350 separate retirement protocol, and PM UAT stay mandatory.
- Review the precise full and incomplete branches, standalone/reference paths, callback surfaces, application packaging, portable export/restore/window and worker return before claiming complete coverage. If a real externally observable consumer cannot be guarded with *independent observation* under the authorized paths, treat it explicitly as a scoped blocker rather than forge a common atomic publisher.

## Alternatives rejected

1. **Claim simultaneous issuer+bank at delivery from sequential point reads:** information-theoretically unsupported.
2. **Add finite retries or reverse read order:** leaves an indistinguishable gap after one final read.
3. **Trust consumer-generated receipts, digest, `verified_complete` string, source reference or untrusted memoization:** no independent source ownership/currentness.
4. **Add a cross-publisher lease or changed revocation rules in #348:** unapproved new publisher authority and possible external side effects.
5. **Treat all per-period callbacks as private or claim streaming proportional without proof:** can expose not-yet-requalified state, violates public-output boundary.

## References

- [PM approval and #348 source consistency decision](https://github.com/bensmullen/personal-finance-app/issues/348)
- [D2 coordinator #149](https://github.com/bensmullen/personal-finance-app/issues/149)
- [S8-5A witness #331](https://github.com/bensmullen/personal-finance-app/issues/331)
- [PFA-DET-023 deterministic capability specification](../../specs/capabilities/deterministic-household-financial-semantics.md)
- [ADR-021](ADR-021-semantic-settlement-funding-and-accounting-authority-boundary.md)
- [ADR-022: proposed retirement publisher frontier](ADR-022-retirement-publisher-live-history-and-atomicity.md)
