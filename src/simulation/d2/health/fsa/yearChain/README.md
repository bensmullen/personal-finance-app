# Conditional FSA plan-year authorization (#148)

`bindFsaYearChain` calls the unchanged `evaluateFsa` on two raw requests. It
binds exact annual adjacent calendars, household/person/employer/plan identity,
source snapshots, year-specific carryover law, successor enrollment, receipt
provenance and proposed closeout. Claim allocation and all amounts remain owned
by `evaluateFsa`. Grace and runout receipts remain in their original plan year.

Calendar sources use `health_fsa_calendar` with the exact `fsaScopeId` subject.
Carryover-law sources use `health_fsa_carryover_law` with the outgoing year's
scope; the separately sourced plan/legal amounts must match that year's rule.
No legal cap or permission is inferred from another year. Full-content canonical
fingerprints detect amendments and ignore fact-array order. They are neither
cryptographic signatures nor proof that supplied evidence is authentic. Source
amendments require a new binding and independent #149 source reconciliation.

The immutable `d2-shared/v1` bundle includes raw inputs, owner evaluations and
their fingerprints, exact parties/members, event and close dates, optional
external closeout claim, transfer identity and receipt/settlement/source-version
provenance. `proposalCoverage: complete` means only that the isolated conditional
proposal has sufficient domain evidence. The nested owner evaluations retain
their own domain coverage; they do not authenticate reimbursement or transfers.

Every bundle is `committed:false`, `postable:false`, overall and successor
coverage incomplete, and `appliedCarryover=0`. Restricted entitlement is excluded
from net worth. Payroll, reimbursement settlement and taxes remain incomplete;
there are no cash, wage, expense-reversal or medical-deduction effects here.

There is no authoritative shared closeout trust port in this scope. Consequently
even matching external closeout evidence or `FsaPriorCarryover.finalized:true`
cannot admit an actual transfer. The latter suppresses the conditional proposal.
All outputs emit `requires_149_authoritative_closeout`. #149 must independently
re-evaluate the bound sources, authenticate complete original claim/payment and
payroll history, reject replay and competing successor claims, then atomically
settle closeout and one unique restricted transfer with a verifiable receipt.
Conflict hints supplied here can reject a proposal, never prove global uniqueness.
No new shared runtime port is introduced. #101 owns payroll/tax characterization.

Tests contain synthetic evidence only. No local verification was run; GitHub CI
and independent latest-head economic review remain required. This domain-only
work does not complete D2-C, physical FSA settlement, or R5 readiness.
