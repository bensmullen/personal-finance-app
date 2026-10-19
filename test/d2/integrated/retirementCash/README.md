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

RMD allocations remain uncommitted conditional evidence. Unsupported purported
posted history is declined without blocking independently safe cash settlement.
No annual satisfaction, persisted distribution, allocation journal, taxable gross,
basis recovery, or withholding credit is produced. RMD and retirement tax output
coverage remain incomplete. The shared authenticated portable withdrawal/RMD
journal remains an open follow-up for #149 and #146; this PR does not close either
roadmap or the D2/R5/UAT gates.

Portable replay uses the existing v3 artifact, participant codec registry, and
checkpoint APIs. An embedding process must import the opt-in retirementCash module
before restoration to register its codec. The fresh-process test does that
explicitly; shared replay composition is outside this authorization. Thirteen
months cross the annual checkpoint, retain the one posted cash identity, and
regenerate the final month without a duplicate transfer or RMD claim.

The existing 55 preparation fixtures remain conditional. These tests are authored
for GitHub CI; no local tests, typecheck, builds, validators, or browser execution
are permitted in this implementation turn. Merge requires external CI and
independent financial-semantic review.
