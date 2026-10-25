# #149 S8-4 — blocked implementation checkpoint

This subtree preserves work in progress for actual joint-household HELOC
servicing. It is **not accepted integration evidence**. No local tests ran:
the one authorized bounded verifier returned SKIP because Node was unavailable.
Original S8-1/2/3 suites and all production code remain unchanged.

## Shared source-reference blocker

Acceptance 5 requires source lookup IDs and compact version/fingerprint
references in participant configuration and checkpoints, excluding full source
documents. The current FSA source contract cannot meet that requirement:

- `src/simulation/d2/integration/fsaCash/source.ts`, `FsaCashReference`, requires
  `expectedSource: string`.
- `fsaCashSourceFingerprint` returns `canonicalSerialize(source)`, containing
  the full original medical/plan/BANK documents and provenance.
- `readFsaCashSource` compares that complete serialization with `expectedSource`;
  a digest of the very same authenticated source is rejected.
- `createFsaCashParticipant` stores the reference in `economicInputs`; its
  portable codec preserves that full source string in replay transport.

`sourceReferenceBoundary.test.ts` characterizes this boundary using unchanged
S8-3 builders, a real one-month kernel run and an actual portable artifact. Its
assertion that the original is embedded is a blocker assertion, not a weakened
acceptance oracle. It also rejects replacing the string with a compact digest.
The source reader continues to require the independently registered publisher.

DECISION_NEEDED: Authorize a shared FSA compact-reference migration, or explicitly
narrow acceptance 5 to the newly introduced HELOC participant.
PRODUCT_IMPACT: The inherited FSA source archive travels inside replay
configuration even though the HELOC participant uses lookup IDs only.
OPTIONS: Migrate the shared FSA fingerprint contract; or explicitly grandfather
the inherited S8 reference format for this stage.
RECOMMENDATION: Authorize the shared migration with restore/version compatibility
and independent-source negative tests, then resume S8-4.
TECHNICAL_REASON: A required complete-document equality contract cannot be
replaced by a compact digest from this test-only authorized subtree.

The narrow shared implementation path requiring authorization is
`src/simulation/d2/integration/fsaCash/source.ts`; inspect the participant codec
in `src/simulation/d2/integration/fsaCash/index.ts` and its existing tests for
version/compatibility implications before choosing the final repair scope.
The inherited funded-retirement schedule also carries raw plans in
`createFundedRetirementCashSchedule.economicInputs`; a subsequent source-reference
audit must resolve the intended reach of acceptance 5 for that existing API.
No test-only authority, fake compact codec or alternate ledger was added.

## Preserved implementation intent, pending CI and semantic audit

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

`jointHeloc.test.ts` proposes exact-dollar baseline comparisons, posting and
receipt identity checks, prior-posted-history carry-forward, source negatives,
and both participant permutations of real auto/HELOC contention on February 15.
Its cent-short case isolates the actual production participant on the same
owned BANK/draw-qualified state, preventing earlier documentary balance checks
from masking the $105.09 versus $105.10 funding failure.

`replay.test.ts` proposes 13 real service occurrences over 25 monthly periods,
summary/detail and selected/split/full equivalence, source requalification,
and eight independent child processes. Only that long test has a 90-second
timeout. `portableWorker.ts` rebuilds every approved publisher from authored
facts before reading artifact bytes and tests original withdrawal/version,
missing BANK, missing approval and changed original history on restore.
Relative serialization checks are bounded and have no fixed byte threshold.
These tests remain unfinished acceptance work until the shared reference
boundary is resolved; they do not prove full D2, tax, future-rate or UAT coverage.
