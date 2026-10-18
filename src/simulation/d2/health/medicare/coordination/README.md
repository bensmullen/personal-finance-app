# Medicare obligation composition — #148 bounded C2-3

`composeMedicareObligations` calls the unchanged C1 `proposePremiums` and C2
`evaluateIrmaa` evaluators. It composes each person's monthly member premium
and the matching Part B/D surcharge once. Gross quote and employer subsidy
remain separate. The embedded C1 proposal and C2 candidate preserve their full
source, income-year, filing/MAGI, tier, determination and identity fields.
`consumedOperationIds` identifies inputs subsumed by the composed claim: a later
executor must not post these inputs again as additional expenses.

Every requested member/month requires a source-qualified exhaustive inventory:
six explicit election/exclusion entries and two surcharge applicability entries.
An excluded Part needs a reason and source; an elected zero needs a C1 quote.
An applicable B/D surcharge requires a complete C2 candidate even when zero.
Missing or conflicting rows remove that member/month's intents and amount;
any incomplete member/month suppresses the household total. Amount coverage is
conditional on the supplied sources, not integrated runtime evidence.

All relevant sources must be verified, effective for the covered month, and
known by the claim event. Historical return source periods refer to their tax
year, while their publication must still precede the claim. Evaluators own
quote reconciliation and IRMAA law/tier selection; this module adds no brackets,
statutory eligibility, rounding policy, override law or inferred lookback.

The bounded supported composition requires whole months and monthly C1 quotes.
The source-authored inventory event must be no later than each claim event;
individual Part quotes retain their own occurrence dates.
Unrepresented bundled Part D surcharge obligations, unsupported calendars,
partial months and incompatible configurations remain incomplete. Advantage
with standalone Part D needs explicit compatible source evidence in addition
to C1 coordination. No source catalog or official plan eligibility is supplied.

Bank intents require an explicit effective owned BANK account. SSA intents use
the unchanged A1 gross-benefit evaluator and require a same-person monthly
verified SSA award plus separate effective legal terms authorizing the exact
Part/coverage/recipient deduction. A gross award alone does not authorize net
payment. Bank routing with concurrent SSA deduction instructions is gated.
All results are copied/frozen; collection ordering conveys no economic priority.

Independent audit must qualify the caller's election inventory, CMS/SSA
authority, source publication dates, plan compatibility and deduction terms.
Synthetic test evidence is not an official source catalog. Tests read the six
unchanged Medicare prep fixtures without promoting their evidence status.

#149 owns actual settlement, aggregate benefit capacity across claims, shared
payer coordination, recognition, ledger/state writes and integrated forecasts;
#101 owns income/payroll/tax characterization. Net cash and tax remain incomplete
and no posting is emitted. This bounded delivery does not close #148, D2 or U1.
Tests are authored for GitHub Actions; local verification is prohibited by the
task contract (AL-003).
