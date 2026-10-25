# #149 S8-4 — joint HELOC and FSA source-reference evidence

This subtree composes real joint-household servicing and portable replay. The
approved repair replaces the former full-document FSA reference with v2 source
fingerprints in both participant configuration and canonical receipt bindings.
Existing S8-1/2/3 fixtures and financial oracles remain unchanged. Exact-head
GitHub CI and independent semantic audit remain required before PM merge.
The authorized bounded local verifier was attempted during this repair but
exited before checks: sandbox permissions denied creation of `.codex/logs`
(`EPERM`). No tests, typecheck, builds or other local verification completed.

## FSA v2 and historical replay

The v2 fingerprint is `fsa-cash-source/v2:sha256:<64 lowercase hex digits>`,
computed over canonical UTF-8 serialization of the entire fresh raw source,
including source ID/version, paid medical original, reimbursement, plan,
provenance, timestamps, payroll and optional year chain. It detects changes;
the independently installed source-owner reader authenticates the evidence.
New source versions serialize only `{ version: providerVersion, inputs: digest }`.
Neither the participant nor receipt stores full FSA originals or plan catalogs.
Canonical `sourceEvidenceFingerprint` retains the existing shared contract,
but its input binding now contains the compact source version.

New participants use `d2-fsa-cash/v2` / `paid-expense-reimbursement/v2`.
The `d2-fsa-cash/v1` codec remains restoration-only: it requires exact agreement
between its historical full-source pin and a fresh independent publisher read,
then preserves its old participant identity and receipt source version. The
shared authority reconstructs either receipt format from that publisher before
canonical journal requalification. Inline artifact evidence is never decoded
into an authenticated provider. A v2 participant cannot relabel an existing
v1 receipt; historical state, transaction and proof identities stay immutable.

Direct FSA tests cover 1/12/120 proportional references, full-source changes,
malformed versions/digests, missing publishers, original $1,000 expense/refund
economics, v1 and v2 cold restore, changed original and missing original proof,
and transport tampering with recomputed integrity. The old blocker test is now
positive v2 acceptance using a genuine summary result for portable export.

## Financial and replay oracles

`scenario.ts` binds all documentary ownership to the existing S8 member and
BANK, adds dedicated principal/charge liabilities, and executes the production
original-draw operation ($1,900 BANK/$900 principal to $2,000/$1,000) to establish
actual draw posting/authorization/quote-receipt history. December interest is
outside this explicitly selected original-draw boundary. Servicing uses the
production adapter and kernel; no test posts a shadow journal.

The authored first/second installments are $105.10 = $100 + $5.10 and
$104.14 = $100 + $4.14. Eleven additional installments each pay $10 principal
and $1 independently quoted interest. They are synthetic complete issuer
statements, not future-rate forecasts. Source records contain documentary
history; HELOC participant configuration contains only their lookup IDs.
January/February card/FSA/retirement facts retain their original economic
amounts. Only the intermediate card/FSA BANK confirmations account for the
February 1 HELOC debit. No mortgage/Medicare source is invented: the inherited
S8 combination supplies auto service and after-tax health premiums.

The fixed month-end BANK truth table is imported from no evaluator or artifact:
1,900; 2,900; 3,100; 3,300; 3,500; 3,700; 3,900; 4,100; 4,300; 4,500;
4,905.07; 5,605.07; 6,605.07 before cumulative HELOC service. November pays
the remaining $294.93 auto service; December has no auto principal. Total
HELOC service is $330.24, principal $310 and interest $20.24; month 25 BANK
is $18,274.83, with HELOC principal $690. These authored values need CI and
independent audit; they are not claimed verified results.

`jointHeloc.test.ts` asserts exact-dollar baseline comparisons, posting and
receipt identity checks, prior-posted-history carry-forward, source negatives,
and both participant permutations of real auto/HELOC contention on February 15.
Its cent-short case isolates the actual production participant on the same
owned BANK/draw-qualified state, preventing earlier documentary balance checks
from masking the $105.09 versus $105.10 funding failure.

`replay.test.ts` asserts 13 real service occurrences over 25 monthly periods,
summary/detail and selected/split/full equivalence, source requalification,
and eight independent child processes. That long test has a 90-second
timeout. `portableWorker.ts` rebuilds every approved publisher from authored
facts before reading artifact bytes and tests original withdrawal/version,
missing BANK, missing approval and changed original history on restore.
Relative serialization checks are bounded and have no fixed byte threshold.
These tests do not prove full D2, tax, future-rate or UAT coverage.

## CI repair and bounded size evidence

The head-b3d050f CI run #40162488195 shard-3 diagnostic archive (artifact
12586833373) showed the 13-payment cold oracle passed in 41.9 seconds. Its
separate reference-growth test failed with **Test timed out in 5000ms** after
8.9 seconds, not a reported fixture mismatch. Only that two-forecast
serialization test now has a justified 25-second timeout; no global timeout
or financial expectation changed. The transaction-leg oracle compares the
exact two posting types without confusing canonical display order with
execution order. The posted-history lookup now uses its branded transaction
ID. The former blocker test exports an actual summary result.

The size oracle compares 1 versus 13 HELOC occurrences across full 25-period
artifacts, checks compact migrated FSA receipt/configuration bindings and absence
of original medical/issuer documents, and retains the relative receipt/payload
bounds. Direct FSA tests additionally check exactly linear 1/12/120 reference
growth with fixed-width synthetic identities; there is no fixed byte ceiling.

**Outstanding D2 obligation:** the inherited
`createFundedRetirementCashSchedule.economicInputs` still contains complete
dated `RetirementCashInput` plans. The size test reports its UTF-8 byte count
separately as `#149 outstanding retirement economicInputs bytes` in CI output.
It is unchanged by this PR, requires a subsequent #149 source migration, and
must be resolved before D2 closeout. This repair proves compaction only for
HELOC and FSA; it does not claim global source-payload efficiency.
