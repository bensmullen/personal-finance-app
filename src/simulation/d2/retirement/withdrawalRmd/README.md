# A4 withdrawal / RMD authorization bridge

`evaluateWithdrawalRmd` implements the conditional bridge in issue #146 and
PFA-DET §5.4 / S1–S8. It reruns the existing, unchanged ordinary withdrawal and
annual RMD evaluators on raw owner inputs. Caller coverage, candidate flags and
purported funded distributions are never accepted as evidence. Any nonempty
`RmdInput.distributions` blocks the entire bundle; the exposed RMD evaluation is
always calculated with empty history and remains unsatisfied.

Author each allocation explicitly. `authorizationId` names the original
withdrawal authorization. `approval.id` is a separate, unique allocation approval;
its `terms` must match every instruction field, including the exact USD amount,
annual obligation/rule identity, household, owner, source account and event date.
The approval includes household-scoped withdrawal provenance for its own ID and
account-scoped RMD permission provenance. Both must be verified and known at the
event. The candidate's original target list must independently include the exact
derived obligation. A target alone grants no allocation permission.

The external binding usage snapshot must exhaustively list previously used
allocation and approval IDs, alongside the existing withdrawal usage snapshot.
These are replay facts, not another mutable capacity register. Repeated source
IDs must describe identical source records. All failures reject the whole bundle
with S7 diagnostics; original owner diagnostics are exposed separately. Expected
RMD `remaining_shortfall` funding diagnostics survive even if conditional
allocations numerically cover the entire requirement. No overall financial
coverage claim is made.

The `d2-shared/v1` bundle version `withdrawal-rmd-authorization/v1` contains exact
gross/net/withholding metadata, independent immutable approval/provenance copies,
canonical raw requalification inputs and conditional `proposedOnTime`,
`proposedLate`, `remainingRequested` and `unallocatedGross` descriptors. Money
and currency primitives are already immutable; caller-owned containers are cloned
before freezing. Canonical ordering is only for deterministic replay, never
economic priority. Allocation totals must fit each withdrawal gross and annual
required amount. Gross is the cap even when withholding reduces bank net.

Only ordinary owner pretax Traditional/SEP/SIMPLE IRA and separately sourced
eligible workplace-plan cash admitted by the withdrawal evaluator can bind.
The RMD evaluator owns prior-year December 31 values, annual identity, explicit
IRA aggregation, beneficiary method, cohort, source rules, first-year deferral
and deadlines. The bridge additionally matches account family/bucket across
owners and requires all RMD evidence to be knowable at the withdrawal event.
Deferred first-year and next-year obligations remain separate. Early proposals
fail; late proposals remain late and never change statutory deadline shortfall.

Every bridge result and bundle is `committed:false`, `postable:false`,
`funding:"incomplete"`, `rmdSatisfaction:"not_applied"`. No callback, setter,
posting, source consumption, bank movement, satisfaction or tax recognition
occurs. Withdrawn gross is neither additional earnings nor another expense.
Withholding credits and net metadata remain exactly as evaluated by the source
owner. Investment sales, Roth/basis ordering, inherited accounts, QCDs,
conversions, rollovers, jurisdictional tax liability and previously posted or
partial-year history are outside this bridge's execution scope.

The future #149 retirement participant must requalify the raw inputs against
authenticated state, reconcile historical satisfaction, recheck usage and actual
cash capacity, and perform one atomic funding/routing/satisfaction transition.
This bundle is permission evidence for that future requalification; it is not
proof of settlement or a portable execution token. #101 retains tax ownership.
CI and independent semantic audit remain required before merge; these synthetic
unit cases provide no integrated-runtime or UAT evidence and do not close D2/R5.
