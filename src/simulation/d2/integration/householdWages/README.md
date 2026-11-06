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

The synthetic `test/d2/integrated/householdBankIncome` suite covers both wage
branches, legacy person routes, multiple members, independent SSA coexistence,
source failures/races, original mismatches, compact multi-period references,
and fresh-publisher portable import. GitHub CI and independent financial review
remain publication gates; the implementation turn does not run those suites.
