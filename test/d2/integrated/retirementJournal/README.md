# J1 retirement evidence foundation — #204

These CI fixtures exercise the optional `retirement-distribution/v1` state record
and its typed canonical writer proof. Only the canonical accounting writer posts
cash. The narrow retirement transition qualifies an independent source port,
stages the two cash legs, proof, immutable journal and one-time identities on one
candidate, then requalifies before committing. Production A4 integration is J2.

The synthetic oracle starts with $1,000 retirement CASH and $200 owned BANK.
Posting $500 gross/net with explicit zero withholding ends at $500/$700 and
preserves $1,200 consolidated wealth. No recognition, income, expense, tax credit,
sale or RMD satisfaction is created. An actual A4 fixture with $700 required
continues to report $700 unsatisfied; its $500 allocation is only conditional,
with $200 remaining requested. Stored structural allocation rows grant no legal
credit, including after replay or independent source requalification.

Tests cover source and witness changes, wrong owners/accounts/years, unsupported
rollover/Roth/inherited distributions, amount/scale/capacity errors, duplicate
transactions and approvals across years, missing actual writer archives,
immutability, failed transitions and later failed kernel periods. Summary/detail
and independent-process replay cover 13 and 25 months, both opening and in-horizon
records, zero and nonzero structural allocation rows, and legacy optional absence.
Recomputed artifact integrity does not authorize changed checkpoint evidence.

When the source owner is unavailable, restored records retain `not_applied` and
`tax: incomplete`; actual archived cash truth remains portable. There is no
source-authenticated annual RMD read API in J1. J2 must bind the actual original
A4 source/approval/obligation to funded distributions, implement the exact
$700/$500/$200 shortfall and approved first-year/two-RMD-year case, and preserve
tax incompleteness until #101. Existing cash-only postings cannot be backfilled.

No local verification is authorized. GitHub CI owns typecheck, tests,
architecture, build and the four existing E2E shards; independent semantic audit
and PM merge approval remain required. Keep #204 open after this stage.
