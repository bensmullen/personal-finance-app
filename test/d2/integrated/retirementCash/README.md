# Retirement CASH-to-BANK runtime boundary (#149)

Synthetic exact-money runtime tests exercise the opt-in retirement participant
through the canonical household kernel in detail and summary modes. The core
oracle moves $500 on 2026-06-15 from $1,000 retirement CASH to an owned $200 BANK:
ending balances $500 and $700, one balanced two-cash-leg transaction, no economic
income, expense, tax credit, sale, or household net-worth change.

Admission reuses unchanged A4 `evaluateWithdrawals`. Actual state ownership and
account kind, independently sourced event cash, external reservations, explicit
all-jurisdiction zero withholding, and one-time authorization/withdrawal/receipt
identities are checked before posting. Unordered cash contention fails closed;
only sourced explicit dependencies establish priority. Failed periods roll back.

Ordinary cash-only inputs preserve that behavior. The explicit `fundedRmd` opt-in
requires a separately registered `RetirementRawSourcePort`, fresh immutable raw
A4 inputs, actual instant availability, exact allocation approvals, and exhaustive
prior J1 history. It invokes `applyRetirementDistributionAtomically` once; J1 owns
the cash posting, immutable archive and one-time allocation/approval inventory.
Neither a conditional bundle nor a caller's `posted_funded` flag grants credit.

`evaluateFundedRmdSatisfaction` exposes the derived S7 annual result independently
of the immutable J1 journal's `rmdSatisfaction: "not_applied"`. Every record is
explicitly requalified through the live source port, checked against current
annual obligation terms and its original actual posting, and fed to unchanged
`evaluateRmdObligations`. Source withdrawal revokes credit while preserving settled
cash. Missing or omitted history fails closed. Grouped IRA allocations are rejected
with `incomplete/unsupported_group_journal` before cash posting; legal group-based
aggregation remains J2-B work. Tax, withholding credit and basis remain incomplete.

Dated plans use `attachFundedRetirementCashSchedule`: each payment date has its
own A4 cash snapshot and immutable publisher reference. The annual source includes
complete prior operation/withdrawal/authorization/allocation usage and all annual
requests for the full compiled horizon. Only the horizon closing operation publishes
RMD capability, avoiding an early monotonic shortfall latch. Unsupported future
years remain incomplete. Tests preserve the independent $700/$500/$200 oracle,
proposed-only zero credit, deferred first-year and separate current-year allocation,
inclusive deadline, late payment and retained deadline shortfall.

Portable replay uses the existing v3 artifact, participant codec registry, and
checkpoint APIs. An embedding process must import the opt-in retirementCash module
before restoration to register its codec. A fresh process must also register the
independent raw publisher; restored bytes never register or authenticate it. Tests
reconstruct the synthetic publisher independently of the artifact in 13- and
25-month processes, retain one physical posting and regenerate the last month
twice. Missing future-year rules remain explicitly incomplete.

The existing 55 preparation fixtures remain conditional. These tests are authored
for GitHub CI; no local tests, typecheck, builds, validators, or browser execution
are permitted in this implementation turn. Merge requires external CI and
independent financial-semantic review.
