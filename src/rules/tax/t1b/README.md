# Isolated federal T1B rules — issue #138

Import `index.ts` in this directory directly. Shared rule exports, annual tax
calculation, household event recognition, settlement and planning integration
are deliberately owned by a later synchronization task. These functions return
values and immutable state; they never post transactions or mutate caller state.

## Law and monetary boundaries

`law` is immutable reviewed 2025 federal data, with a canonical content identity,
version, half-open effective dates, source URLs and review date. Other years are
unavailable unless the caller explicitly elects the labeled 2025 nominal-current-
law projection scenario. That election is preserved in every trace and never
asserts verification of future law. USD amounts use existing exact Money values
at currency precision. Fractional share quantities use DecimalAmount with an
explicit shares unit. Proportional loss allocations round cumulative amounts to
cents, half even, then take differences; a fully matched sale conserves its exact
loss. Algorithm changes require a rule version change.

## Input and state ownership

- Wash matching takes original, authoritative sale and acquisition facts, actual
  execution order and evidenced pairwise legal similarity and replacement
  availability. Account coverage must include spouse, controlled entities and
  external accounts through the inclusive post-sale window. Acquisition facts
  identify disjoint lot quantities; already disposed shares cannot be asserted
  available. Chronological sales match chronological acquisitions, never array
  order. Unknown legal coverage gates the result. An acquisition quantity is used
  once across sales. Closing state retains original facts and matched segments,
  basis increments, tacked holding days and permanent IRA disallowance. Replay
  returns absolute replacement basis, **not an adjustment command**. Full prior
  history must be supplied unchanged when using opening state. Chained sales of
  a basis-adjusted replacement lot are explicitly unsupported until the
  authoritative lot realization owner supplies the re-recognition seam; this
  matcher does not silently use unadjusted losses for such sales.
  Sale character must agree with supplied tax holding days under the ordinary
  calendar-year rule (including leap years); contradictory special-character
  facts require a separately supported capability, not a completed loss.
- Capital netting requires explicit opening short/long loss state and a signed
  authoritative taxable-income figure **after** the Schedule D deduction and
  **before** Form 1040's zero floor. A displayed taxable zero cannot substitute
  for that figure. Worksheet lines 1–4 determine loss consumption; lines 5–13
  retain character and apply the short-term loss first. Scheduled deduction and
  worksheet loss consumed are distinct. Closing state is the exact opening state
  for the next year, preserving owner, filing status, rule identity and lineage.
  Missing prior state, filing allocation changes, NOL/debt attribute interactions,
  unsupported gain categories and final returns gate carryover.
  Version 2 uses standard SHA-256 canonical content references for trace inputs,
  capital results and state integrity. State keeps a fixed four-reference lineage
  (root source, opening result, authoritative return, current result), plus the
  immediately preceding trace and opening-state reference. It never embeds an
  earlier result or trace recursively. Retain annual receipts separately, keyed
  by result identity, to resolve the full provenance chain. The predecessor
  records exact year, rule/version, sources, assumptions and input identity;
  replay checks state integrity and year/owner/rule links before consuming losses.
  Content identities detect inconsistent receipts, not forged caller assertions.
  Prior version state must be re-evaluated under version 2, not silently relabeled.
- Harvesting consumes paired authoritative engine receipts. The adapter must
  bind the liability to the supplied capital result identity, original proposal,
  selected lots, scenario, unchanged household facts, coverage, rules, periods
  and horizon. Candidate realized amounts must reconcile to baseline plus the
  wash-adjusted proposal by character. The function subtracts supplied liabilities
  and explicit transaction costs; it does not calculate liability or infer a
  marginal rate. Future carryover value stays unpriced, and exposure changes
  require explicit acknowledgment. Receipt assertions are a caller authority
  boundary, not cryptographic attestation or independent liability verification.
- The 1031 evaluator admits only two evidenced domestic non-depreciable land
  parcels under the same taxpayer, with qualifying use, QI/no-receipt facts,
  verified actual replacement receipt and documented return due date/extensions.
  Receipt within 45 calendar days is legally deemed identification (Form 8824
  line 5); later receipt requires timely signed/delivered written identification.
  Unknown receipt/QI facts remain incomplete. Any supplied identification date
  must still be well formed and chronologically consistent. A transfer-year
  calendar return due date before year end is invalid, even if asserted verified.
  The deadline uses the statutory due date, not the actual filing date, and
  applies no inferred weekend or disaster extension. Consideration must
  independently reconcile before Form 8824 lines 15–25 are applied. Cash boot
  cannot be offset by excess assumed liabilities; debt boot can be offset by
  debt assumed and cash paid. Qualifying expenses reduce boot first and only
  the remainder increases basis. Loss stays unrecognized with a signed deferred
  loss and unrecovered replacement basis. Non-like boot received has supplied
  FMV basis; non-like property given, recapture and specialized structures are
  unsupported. Depreciable buildings, improvements, cost segregation and unknown
  depreciation history are capability-incomplete, never guessed ineligible.

Each outcome carries rule/source/context/input lineage. A known failed predicate
in an otherwise supported exchange yields ineligibility; missing facts or
unsupported structures yield machine-readable incompleteness without a purported
completed benefit. These domain boundaries do not gate unrelated household
outputs. Synthetic test fixtures supply facts/receipts, never law.

GitHub Actions owns type checking and deterministic fixture execution. Local
tests, builds, validators, installation and development servers are prohibited
for this implementation turn. Passing CI, independent financial audit and the
later household integration remain separate from publishing this foundation.
