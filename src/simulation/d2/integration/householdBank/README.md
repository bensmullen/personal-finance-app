# Household BANK source/state seam (D2-D S1, #276)

This module owns original household BANK route qualification. State owns the
canonical writer, one posting proof per actual transaction, append-only proof
index, checkpoint delta, and cold-import validation. No financial adapter or UI
is integrated by S1; #149 and dependent stages remain open.

At the composition root, register the independent BANK original provider using
`registerHouseholdBankOriginalProvider`. Its query carries actual run, event,
household, person, account, direction, asOf and dataCutoff. It must return a
complete scoped revision inventory for four separate facts: account ownership,
household identity, membership, and permission. The publisher retains original
documents and the complete wider inventory; each query returns only the four
fact histories relevant to that member/route. Dates use half-open effective
periods. Known amendments/revocations replace earlier publications; unavailable
future publications cannot grant present authority. Ambiguous publications fail.

`qualifyHouseholdBankRoute` derives an immutable bounded pin from that source.
It grants BANK eligibility only. It cannot serve as a wage, SSA, pension, FSA,
issuer, enrollment, plan or tax original.

Future domain owners must separately register a tagged family/publisher port
with `registerHouseholdEconomicOriginalAuthority` in state. The port must
reconstruct its exact signed transaction, source, payer, beneficiary, authentic
run/event/cutoff context and complete required family set from its independently
controlled original archive. A domain may explicitly bind and reverify its
existing source port here. Do not echo the caller's transaction, infer a cutoff,
use a generic verified flag, or serialize a provider. Amendments/withdrawals must
return no qualification. Source/payer and member/beneficiary are separate typed
identities. References and digests detect change; registration authenticates
the publisher. No domain port is installed by default.

Call `applyHouseholdDomainTransactionAtomically` with the actual transaction and
versioned evidence. Each required family independently confirms the entire
combined journal and family inventory, so a later wage/payroll-health caller
uses one combined proof rather than posting twice. The helper qualifies sources,
stages the existing `applyAccountingTransactionAtomically` writer on an isolated
candidate, then requalifies before committing. Direct household proof writes,
backfill, duplicate event/transaction identities and funding failures reject
without changing committed state.

The additive `household_domain` registration has an explicit versioned route
and economic witness inside the existing canonical proof envelope. Legacy v1
proof bytes, person-owned BANK equality and first-member archive pins remain
unchanged. Only this opt-in registration pins BANK ownership to the household,
allowing multiple independently authorized members to share its single balance.
Owner, kind, currency, household and event identity cannot be rebound.

No new checkpoint record or serializer is required. The existing
`d2PostedTransactions` checkpoint key carries bounded immutable references and
event context; raw source documents, rosters and tax catalogs remain with their
publishers. Cold imports/checkpoint appends freshly qualify each new proof.
The existing `requalifyD2SettlementReceiptHistory` replay boundary also rereads
both source authorities. A fresh process must register both BANK and economic
publishers before restore. Cached index validation is structural consistency,
not durable source admission. Warm appends traverse changed index paths only;
explicit whole-history requalification is reserved for replay boundaries.

Independent acceptance suite:
`test/d2/integrated/householdBankAuthority/authority.test.ts` covers canonical
commit/rejection, two members, both directions, economic-vs-BANK provenance,
source revisions/cutoffs/races, combined families, legacy proof preservation,
full import/checkpoint delta, fresh-process registration and 1/12/24 growth.
CI and independent semantic/legacy/replay/growth audit remain merge gates.

## VS2 expense source port (S1c, #286)

`expenses.ts` exports `HouseholdExpenseSourceRef` and
`registerHouseholdExpenseOriginalProvider`. A composition root registers a
separate economic publisher and the existing independent BANK publisher before
execution or cold restore. A producer opts in with
`RecurringExpenseStream.householdExpenseSource`: a versioned economic original
address, beneficiary Person, and BANK publisher/source address. No provider,
roster, quote inventory, verified flag or permission trace travels on the stream.

For each active occurrence the economic publisher receives only the pinned
original reference and authentic settlement context. It must independently
reconstruct the expense ID, occurrence ID, monthly period, claim ID, Person
payer/beneficiary, complete observation boundary, exact `expense_recognition`
journal (expense to payable) and `expense_settlement` journal (payable to BANK),
including their existing IDs, cents and trace metadata. It must reject changed
revisions, unavailable publications, withdrawn obligations, and unsupported
events from its own source archive. Returning the candidate's journal or merely
confirming a permitted BANK route does not satisfy this port.

VS2 builds the context from the actual request household/run/asOf/dataCutoff,
stream Person payer, and scheduled settlement instant/identity. The qualified
route requires a household-owned checking/savings account and a single
non-partial funding policy targeting that account. Unsupported partial or split
funding is diagnosed. Recognition stays separate from payment. Insufficient
liquidity preserves the whole unpaid claim with the existing availability
diagnostics, no cash debit, no settlement identity and no posting proof; the
original and route are reread before retaining that recognition. A funded event
posts its actual unchanged settlement through S1's atomic writer, which rereads
both sources around commit and archives exactly one witness/proof. Replay uses
the same registered economic publisher to reconstruct the settlement again.
No per-event source cache or full-history lookup is introduced.

Handoff to **#278 standalone Medicare** and **#280 after-tax premiums**: their
real source owners must install this port, reconstruct the two ordinary VS2
journals from their genuine originals, and supply the new stream binding.
Their adapters retain their current Person-account guards until those separately
owned tasks qualify household routes. Omitting the binding never authorizes a
source-specific household premium. Ordinary historical streams retain their
existing generic path; this bridge does not infer a domain from account owner,
household roster or trace markers. No further VS2 change should be necessary.
S1b's native state contract must be reconciled by the independent audit before
these dependent integrations launch. This is not #149/D2 financial closeout.

`test/d2/integrated/householdBankExpenses/expenses.test.ts` exercises direct VS2,
compiled detail/summary, funded/unfunded recognition, two Person payers, source
rejections/races, same-instant ordering, legacy journal equality, cold portable
restore and 1/12/24 bounded proof growth using generic synthetic originals.
