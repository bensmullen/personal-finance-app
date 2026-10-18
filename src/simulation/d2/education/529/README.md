# Conditional 529 distribution foundation — #147, B3-1

`propose529Distribution` is a pure, private `d2-shared/v1` proposal seam under
PFA-DET §5.7, PFA-INV-028 and PFA-TAX-015. It supports ordinary original-owner
distributions from existing unencumbered plan cash, with source-attested US
federal character and an explicit legally supplied aggregate allocation model.
No statutory values or actual legal eligibility are embedded here.

Qualification requires postsecondary tuition, dated beneficiary/student/term and
institution proof, an exact eligible bill less explicit scholarship, grant,
credit, other-plan and reimbursement adjustments, and a complete current usage
register. Empty adjustments require an explicit completeness attestation. The
stable `paidExpenseId` follows the original bill across renamed requests. Prior
posted or independently authorized pending claims reduce its remaining expense;
registers exclude adjustment allocations already subtracted from the bill.
Conflicting or overlapping requests receive no proposal. No request wins capacity
because it appeared first in an input array.

The snapshot is the current plan-wide value, contribution basis, earnings and
unencumbered cash immediately before the proposed operation. Complete funded
contribution lots less historical basis recoveries must reconcile current basis;
basis plus earnings must reconcile current value. Historical distributions are
already reflected in that snapshot and are never subtracted again. Historical
qualified distributions must match posted usage by operation, claim, bill,
plan/provider, amount and date. Missing value, basis, earnings or cash is explicit
`null` and yields incompleteness.
Loss/special allocation models are outside this initial nonnegative pool model.
Allocation multiplies gross by aggregate earnings before dividing by total value,
using exactly one sourced whole-cent rounding step; gross less allocated earnings
is recovered basis. A nonqualified distribution requires its own supplied legal
treatment. A failed qualified request never becomes nonqualified automatically.

Sources have publication, as-of, effective half-open periods, jurisdiction,
version, rule family/snapshot, verification and projection status, currency and
scoped identities. Only verified coverage known by the event is admitted;
historical source publication cannot follow its historical event. Current cash,
value, beneficiary qualification, usage and recognition proof must be dated at
the event. State/local effects remain separately incomplete for #101.

S1–S8 handoff:

| Seam | Private proposal evidence |
| --- | --- |
| S1 | Owner/household/beneficiary, plan/provider, container/cash/destination accounts, basis-lot identities and tax bucket |
| S2 | Admitted source records and rule snapshot, effective periods, jurisdiction/version and observed verification |
| S3 | Authored stable operation/claim IDs, actor, effective date/year, movement priority and dependencies |
| S4 | Paired plan decrease and bank receipt or institution claim settlement, separate optional expense recognition, exact funding proof |
| S5 | Original aggregate value/basis/earnings and proposed basis decrease; no capacity mutation |
| S6 | Separate gross/basis/earnings federal character; no liability, penalty, withholding or tax-payment calculation |
| S7 | Source-linked per-output completeness, diagnostic path, missing facts and year period |
| S8 | Synthetic exact-cent isolated tests; original preparation catalog stays conditional/decision-required |

Bank routing requires verified same-date owned cash and the actual expense payer
and bank identity. A bank receipt is an owned transfer. Direct pay requires the
institution/payee match and a sourced unpaid institution claim; settlement and
expense recognition remain separate. `planAssetDelta` represents the plan's
single decrease, including its cash; it is not an extra wrapper posting. The
paired movement has zero net-worth change, conditional on settlement of that
verified claim or receipt in the owned bank. Direct pay reports a negative claim
liability delta and a separate institution payment amount; external institution
cash never becomes owned household cash. Any previously unrecognized bill is
a separate expense recognition of its sourced billed amount, keyed once by
`economicExpenseId`, independently of how much this distribution funds.

Every proposal is uncommitted and non-postable. #149 must recheck the complete
usage register, operation/claim identity, current plan cash/value/basis and exact
destination proof, then atomically post movement, applicable recognition and
usage/basis consumption. Re-evaluation replaces the proposal for the same IDs;
it cannot itself consume funds or prevent concurrent posting in another system.
Insufficient cash yields typed incompleteness without partial funding or a sale.

Roth rollovers, IRA capacity, plan transfers, beneficiary changes, contributions,
special expense categories and statutory penalty/recapture/deduction treatment
remain outside this phase. #149 owns physical settlement, #101 owns tax authority,
and #120 owns authoring/UAT. This is neither complete B3 nor integrated evidence.
Ordinary verification belongs to GitHub CI; no local verification is run in the
Codex implementation turn. #147 remains open.
