# Independently sourced household wages (#277)

Composition registers `registerHouseholdWageOriginalProvider` separately from
the BANK publisher. The employer archive receives only the source address and
actual event/run observation context. It returns the complete publication,
revision and withdrawal inventory. Each immutable publication owns the legal
Person recipient, employer, BANK route, original recurring stream terms and
independently reconstructed signed installment journal. Later known publications supersede earlier ones;
ties, missing sources, withdrawals and mismatched pins fail closed.

`householdWageOriginalDigest` pins the publication and recurring source terms.
The stream carries only the revision reference and BANK source address. The
publisher retains the original archive and reconstructs only the queried
month's installment; neither posting proofs nor checkpoints copy that inventory.
Reinstall independent publishers before cold
restore. Reference validation does not authenticate an unregistered publisher.

Both actual VS2 income branches pass their real household, Person, runId,
asOf/dataCutoff, occurrence, period, amount and transaction to qualification.
The direct branch keeps `income` and its two legs; the candidate branch keeps
`payroll_income`, contribution and withholding semantics. State independently
reconstructs the original around its existing canonical atomic writer and owns
the single posting registration and replay proof.

SSA exclusivity checks the independent employer publication against the full
original wage stream terms, and rechecks around SSA execution. SSA itself still
requires independently bound A1/C2 originals. Generic streams and repeated
source representations remain inadmissible. Same-instant SSA BANK contention
still requires explicit scheduler dependencies. SSA household receipts carry
the native v3 attachment, checked against the actual participant run context;
legacy person-owned v1/v2 receipts remain on their original paths.

Combined household payroll-health is capability-gated with
`HOUSEHOLD_PAYROLL_HEALTH_REQUIRES_S4`. Existing person-owned payroll-health
posting remains under its original authority. No additional wage proof is
generated for a combined household payroll-health candidate in this stage.

## Canonical modeled salary

Canonical cash-flow compilation can issue `modeled-payroll/v1` references only
for an authored Person member's salary deposited into a Household-owned
cash/checking/savings BANK. The historical two-spouse family-HSA forecast that
deposits one spouse's wages into the other spouse's Person-owned checking
account remains on the original D1 path **without** this Household-only
reference. The reference binds the complete compiled salary, recipient, actual
bank owner/kind, scenario and effective compiler horizon to the issuer's
reference-identity-scoped, weakly owned inventory (not a process-lifetime Map). A hash, trace label or copied reference on different economics grants
no authority. VS2 rechecks each reference and evaluated occurrence before either
the original direct `income` journal or `payroll_income` candidate can post.
These forecasts never create D2 originals or satisfy SSA wage exclusivity.

Household compilation reissues the binding after annual-policy/tax-account
reconstruction; the forecast boundary reissues it after scenario application.
Immutable kernel copies carry only typed references. A single bounded v3 replay
extension holds the effective request, model/context fingerprints and an ordered
source manifest, without copying the model or monthly source histories.
Application restore requires a separately supplied canonical model and invokes
the registered application recompiler before kernel/checkpoint admission.
Missing, changed or unsupported model evidence fails closed. Warm/retained
artifacts and cached explanations still check that independent source; legacy
non-model v1/v2/v3 and independent wage/SSA publisher qualification are unchanged.

The synthetic `test/d2/integrated/householdBankIncome` suite covers both wage
branches, legacy person routes, multiple members, independent SSA coexistence,
source failures/races, original mismatches, compact multi-period references,
and fresh-publisher portable import. GitHub CI and independent financial review
remain publication gates; the implementation turn does not run those suites.
