# Medicare BANK integration assertions

These new synthetic cases exercise the real `runHouseholdKernel` VS2 journal,
claims and settlements. Synthetic quotes, CMS tables, returns and ownership
evidence are invented test data, not official law or personal financial data.

Assertions written in `settlement.test.ts` cover:

- June B $80 and D $120, BANK $2,000 → $1,800, expenses $200, net worth −$200,
  no SSA income/right, no tax credit, two cleared Part claims and balanced journals.
- B or D alone with no SSA award; exact nonzero Part-specific IRMAA; sourced-zero
  A without a zero recognition; savings and separately owned second-recipient
  funding across December/January.
- Reversed source ordering, exact no-op reattachment, changed bindings, named-bank
  ownership/classification, payable/provider/Part/quote identity and UUID collisions.
- All-or-none underfunding with an actual unpaid D claim and shortfall; unresolved
  unrelated same-day BANK contention without committing a partial period.
- Thirteen independently sourced monthly requests across tax years, summary/detail
  statement and state parity, v3 checkpoint export/restore and last-month detail
  reproduction through the existing replay API (no custom receipt or wire format).
- Late sources despite a later forecast cutoff, missing CMS/lookback, projected law,
  exclusive routes, existing SSA participant, duplicate statement/Part, cancelled or
  changed plan, forged confirmation/source and partial-month request rejection.
- Source-attested equivalent generic premium replacement, rejection of material
  amount/priority differences, and preservation of independent unrelated expense.

No tests, typecheck, build, architecture/spec validator, browser, benchmark or CI
polling were run in the Codex implementation turn. Selected GitHub Actions checks
are expected to include strict TypeScript, financial identity/input immutability,
build, architecture/specification, unit tests and the four E2E shards. Results and
latest-head semantic audit remain external gates before PM merge. Existing D2 prep
fixtures retain conditional coverage and issue #149 remains open.
