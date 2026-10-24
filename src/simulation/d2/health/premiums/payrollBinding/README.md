# C1-2 conditional premium-to-original-payroll binding

`proposePayrollPremiumBindings` reconstructs the unchanged C1 `proposePremiums`
result from independently retrieved original `PremiumRequest` inputs. Submitted
proposals must match those results exactly. Deterministic read-only `originals`
ports retrieve employer/job/paycheck/election facts and independent legal-base
facts by original source identity/version. They must never echo the submitted
proposal or binding as authentication. A string source ID alone is insufficient.

The original wage journal is the signed **no-health** original payroll quote,
with its complete existing contribution and #101 withholding inventories. Its
transaction ID is `tx:recognition:income:<incomeId>:<Instant>`. The original
employer explicitly maps one full C1 quote occurrence to that precise paycheck;
the module never converts a civil coverage date into a paycheck Instant. The
member share must fit the gross remaining after the sourced inventories.
Existing factual withholding is preserved, never recomputed or claimed to be
correct after the conditional health deduction.

Only `full_quoted_occurrence` allocations are supported. Monthly or annual quotes
are never divided across paychecks. A two-paycheck month requires independently
quoted, distinct full member-share occurrences with original employer claims;
any future partial-allocation contract belongs to a separate owner phase.
Overlapping coverage still requires original C1 coordination. Family members do
not multiply the family quote. Duplicate quote occurrences, claims, original
paycheck operations and cross-job election identities fail without selecting an
iteration-order winner. Source-owned prior allocation checks suppress already
allocated premiums. No source histories or signed journals are copied to output.

The intent retains exact `PayrollHealthSourceBinding`, compact original quote,
employment/election references, no-double-counting claim keys, and all distinct
applied legal bases with their rule/plan provenance. A source-owned complete
jurisdiction/regime inventory, elected Section 125 qualification and all dated
matching legal bases allow only `documented_conditional` legal candidates. Missing
law, applicable local bases or qualification stays explicitly `incomplete`.
This is not `PayrollHealthDeductionEvidence`, a source verification, a tax
calculation, an authoritative wage-base exclusion or a payroll receipt.

Every intent/effect is immutable, `committed:false`, `postable:false`. A zero
member share retains its plan/election evidence without a fabricated zero
healthcare expense. Employer subsidy is informational, with no employer BANK
flow, household spending or salary effect. Bank, tax, net pay, recognition and
settlement remain S7 incomplete. Unavailable diagnostic periods are `null`, not
invented paycheck dates. Precise known periods remain half-open.

#149 must independently register/requalify `PayrollHealthSourceAuthority`,
resolve the proposed healthcare expense identity, cross-check every original
claim/inventory/legal base, and execute through `payrollContributionCandidate`
and `applyPayrollHealthTransactionAtomically`. This module neither invokes nor
registers those authorities. It cannot create balances, withholding credits,
expenses, settlement or canonical state. Legacy no-health and `aftertax_bank`
execution remain outside this module. GitHub CI and independent semantic audit
own verification; domain tests are conditional evidence only.
