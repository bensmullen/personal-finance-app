# #149 S8-3: funded account-scoped joint-household acceptance

This test-only extension consumes merged J2-A #215 and the S8-2 #216 scenario.
Starting `origin/main`/HEAD was `da90f87`; remote state was refreshed before
editing. Prerequisite #209/#210/#211/#214/#215/#216 behavior is consumed without
editing its source or tests. S8-1, S8-2 and the 55 preparation fixtures remain
unchanged. Authority: PFA-DET-015/016/017/020/023, PFA-TAX-015, controlled
deterministic-household-financial-semantics §5.4/5.11 and D2 follow-on-plan.

`fundedScenario.ts` removes only S8-2's test structural J1 participant and
attaches the production `attachFundedRetirementCashSchedule`. All wages, C1
premiums, VS4 debt, issuer interest/payment and FSA charge/deposit execute in
the same `runHouseholdKernel` state. No test applies financial deltas, writes
transactions, substitutes RMD arithmetic or installs an artifact echo authority.
Read-only retirementCash documentary builders supply synthetic facts, rebound
to this household's actual member/IRA/BANK and explicit event dates. The raw
publisher map authenticates those facts independently in each process.

## Independently authored USD truth table

Opening BANK 2,000 + IRA cash 1,000 = assets 3,000; auto principal 5,000 +
issuer principal 1,000 = liabilities 6,000; net worth −3,000. Retirement
withdrawals only move already owned cash. Synthetic annual prior value 1,400 /
source-confirmed divisor 2 gives an account-scoped 700 RMD. These are synthetic
cohort/table facts, not assertions about actual statutory law.

| Date/event | BANK | IRA cash | Other effect |
| --- | ---: | ---: | --- |
| Jan 5 wage | 3,000 | 1,000 | Income +1,000 |
| Jan 10 medical charge | 2,000 | 1,000 | Expense +1,000 once |
| Jan 15 premium and debt service | 1,200 | 1,000 | Expense 300 + 50; auto principal 4,550 |
| Jan 22 first funded J2 transfer | 1,700 | 500 | RMD credit 500, remaining 200; income/NW delta zero |
| Jan 23 separately authorized transfer | 1,900 | 300 | RMD credit 200, remaining zero; income/NW delta zero |
| Jan 31 issuer interest | 1,900 | 300 | Liability +20 and expense +20 once |
| Feb 5 wage | 2,900 | 300 | Income +1,000 |
| Feb 15 premium and debt service | 2,100 | 300 | Interest 45.50; auto principal 4,095.50 |
| Feb 15 17:00 issuer payment | 1,900 | 300 | Card liability 820; no second expense |
| Feb 16 medical reimbursement | 2,900 | 300 | Expense credit 1,000; no earned income |

January closes with assets 2,200, liabilities 5,570, NW −3,370, income 1,000,
expense 1,370; operating cash −350, investing zero, financing −450. February
closes with assets 3,200, liabilities 4,915.50, NW −1,715.50, income 1,000,
net expense −654.50; operating cash 1,454.50, investing zero, financing −454.50.
The issuer adapter classifies its whole 200 payment as operating cash. This
does not change the issuer's 20 interest / 180 principal allocation.
Restricted FSA entitlement 1,000 stays excluded from NW. Accounts are exactly
BANK and IRA cash; no account container or conditional 529 value is added.

There are 11 January and 9 February transactions. Canonical archives are exactly
the two FSA postings, issuer charge/payment, `withdraw:s8-3:first` and
`withdraw:s8-3:second`; there are two actual settlement receipts. Each J1 record
matches independent raw-source qualification, trace IDs and exact posting proof,
with distinct withdrawal, authorization, allocation and approval identities.
Journal `rmdSatisfaction: not_applied` is intentionally immutable: the derived
annual read model authenticates credit, rather than posting another satisfaction
ledger or inventing income. A one-transfer variant independently asserts 200
remaining and the same NW/income as the two-transfer case.

## Deferred year and conditional education boundaries

The deferred variant leaves 2026 retirement cash untouched and uses the actual
April 1, 2027 J2 transfer for two separately approved allocations: 300 to the
true first-year deferred 2026 obligation, 200 to the independent 2027 obligation.
The first-year cohort is 1956/start age 70, explicitly synthetic. The 2027
factor is separately source-published for age 71 and the prior value date is
December 31, 2026. The journal payment year remains 2027; remaining obligations
are 400 and 500. A 500.01 allocation against 500 actual funding is rejected.

Independent fixed debt closing principals after each 2026 payment are 4,550;
4,095.50; 3,636.46; 3,172.82; 2,704.55; 2,231.60; 1,753.92; 1,271.46;
784.17; 292.01; 0; 0. Ten 500 payments and November's final 294.93 total
5,294.93. With 12 wages, 12 premiums, the 200 card payment and net-zero medical
cash, deferred-case December BANK is 4,905.07. Three subsequent wages give
7,905.07 immediately before April 1; the transfer and April wage close BANK at
9,405.07 with IRA cash 500. No production run supplies these confirmations.

`funded529Scenario.ts` supplies a different beneficiary and non-colliding plan,
holding, operation and destination identities for the actual B3-2 pure evaluator.
The 200 conditional proposal has 1,000 eligible value and 500 annual room.
It remains uncommitted/non-postable. Original 1,000 plan value, 800 basis and
zero annual/compensation usage remain exact; no cash, Roth basis, capacity or
529 asset is mutated or posted. This is eligibility evidence only.

## Failure, replay and honest S7 status

Focused cases reject missing/changed publishers, stale annual value/history,
duplicate withdrawal, allocation above gross and annual capacity, wrong owner
or account, legacy cash-only upgrade, forged restored proof/journal, stale
second confirmation and unrelated real VS2 same-instant BANK work. Applicable
cases run participant arrays forward and reversed. A failed January preserves
the opening exactly; a late February failure preserves the complete funded
January and rolls back February's wages, debt, issuer payment and reimbursement.
No new global priority is authored. Historical physical cash survives loss of
J2 source qualification while historical RMD credit becomes unsupported.

`fundedReplay.test.ts` independently exercises 13/25 months, summary/detail,
month-12/24 checkpoints, empty later J1/proof/receipt deltas, January/February
opening replay and late checkpoint replay. A fresh worker reconstructs publisher
facts before reading artifact bytes and must actually consult its publisher.
Missing/tampered publisher qualification rejects new posting and withdraws RMD
credit, while preserving committed historical cash. Wire forgeries recompute
integrity and still must fail canonical/source validation.

For the funded 2026 horizon, cash transfer, actual FSA settlement and annual RMD
source coverage are complete. Retirement tax, FSA payroll/tax and future issuer
cycles remain incomplete; total cash/NW are explicitly tax-affected incomplete.
Longer horizons also report incomplete RMD coverage for missing future law,
even with 700 genuine historical satisfaction. The forecast stays incomplete.
No PFA-TAX-015, D2, R5, U1/UAT or whole-product acceptance is claimed.

No local tests, typecheck, builds, validators, dependency installs or CI polling
were run. Existing CI selects unit/typecheck for test-only paths; architecture,
build and the four E2E shards remain external merge evidence required by #149,
not results asserted here. No workflow files are authorized for this turn.
No 649-month or other full-scale workload is added. ChatGPT independently audits
the exact pushed PR head and updates #149; PM retains merge approval.
