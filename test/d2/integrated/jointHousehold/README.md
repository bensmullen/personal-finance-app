# #149 S8-1 joint household execution evidence

This test-only bridge runs C1 bank premiums, VS2 wages/spending and VS4 fixed
auto debt in **one `runHouseholdKernel` state stream**. No test applies account
deltas, posts its own transactions, substitutes a calculator, or modifies catalog
coverage. CI must establish whether these assertions pass; Codex does not run
local verification or poll CI (AL-003). This is not D2 completion or PM UAT.

## Sources and explicit synthetic terms

- Read-only `test/fixtures/d2/catalog.json`: `health_after_tax` supplies the $300
  member amount and bank-route anchor. This scenario explicitly narrows coverage
  to the one wage-recipient/insured member and adds a separately sourced $100
  employer share ($400 gross). Employer share is neither household income nor
  household expense. Confirmations bind the regenerated C1 proposals to one
  identified, member-owned checking account and a separate premium payable.
- `auto_final_interest` supplies 12% nominal annual / 12, monthly simple interest,
  no capitalization, all-or-nothing cash funding and USD cents half-up rounding.
  `auto_zero_rate` and `debt_unfunded` remain unchanged preparation anchors.
  Their `integratedRuntimeEvidence` flags are deliberately still false.
- The synthetic `12-month-contract` source explicitly selects $5,000 original
  and opening principal, 12 monthly payments from January 15, 2026, fixed rate,
  no recast, named checking-only funding, and separate principal/interest
  liabilities. P22's payment formula is
  `5000 * .01 * 1.01^12 / (1.01^12 - 1)`, rounded to **$444.24**.
  The separately authored `optional-55.76` source authorizes $55.76 extra
  principal on each contractual date. Thus January's **total** service is $500:
  $50 interest + $394.24 required principal + $55.76 optional principal.
  This does not claim a $500 required amortizing payment. February interest is
  $4,550 × .01 = $45.50, and total principal reduction is $454.50.
- `synthetic:#149:wage-deposit-1000` supplies an ordinary recurring $1,000 VS2
  wage deposit on the 5th. Withholding and gross-to-net payroll/tax calculations
  are absent. All source dates are known at the December 31, 2025 as-of boundary;
  identities and inputs are synthetic, with no real household data.
- Authority: executable financial semantics §4.4 recognition versus settlement,
  §5.3 consolidated aggregation, P22 required-before-extra dependency; capability
  `deterministic-household-financial-semantics.md` PFA-DET-019/020 and §5.4–5.7.
  C1's audited `aftertaxPremiums` tests are read-only API references.

## Scenario → actual ledger → independent expected state

All amounts below are exact USD. Expected amounts are constants, not calculated
by the production loan/premium helpers. Transactions balance by currency.

| Scenario | Actual ledger evidence | Expected committed state / result |
| --- | --- | --- |
| January, opening bank 2,000 / loan 5,000 | Wage Dr bank / Cr income 1,000; premium Dr expense / Cr payable 300 then Dr payable / Cr bank 300; interest Dr expense / Cr interest payable 50 then Dr payable / Cr bank 50; required principal Dr loan / Cr bank 394.24; optional principal Dr loan / Cr bank 55.76 | Bank 2,200; loan 4,550; both payables zero; assets 2,200; liabilities 4,550; NW −2,350 versus opening −3,000, delta +650; income 1,000, expense 350; operating cash +650, financing cash −450 |
| February continuation | Same identities qualified by distinct month; interest 45.50; required principal 398.74; optional principal 55.76 | Bank 2,400; loan 4,095.50; NW −1,695.50; period expense 345.50; 10 recognition IDs, 8 settled claims/rights and 8 settlement IDs over two months |
| Smaller opening bank 400; payday moved to 20th | On 15th, premium can settle alone; required 444.24 cannot. Different legal orders change available cash/shortfalls | `incomplete`, `HOUSEHOLD_CONTENTION_UNRESOLVED`; no committed period; exact opening bank 400 / loan 5,000; no committed claim, interest, shortfall or wage from the rolled-back candidate |
| Smaller opening bank 100; payday on 20th | Neither all-or-nothing payment can settle on 15th; wages arrive later without a fabricated retry; extra is ineligible | Bank 1,100; loan 5,000; premium payable 300; interest payable 50; required-principal claim 394.24 (already represented by loan, never counted twice); 2 shortfalls, no settlements or extra right; NW −4,250, delta +650 |
| Same-day wages/premium/service with ample opening cash | Production scheduler explores material order; reverse confirmation and extra-instruction input arrays | Same deterministic full result/fingerprint, bank 2,200 then 2,400; no incidental arrival precedence |
| Replay / reattachment | Regenerate detail from immutable opening, exact reattachment, then 13-month bounded summary for first real month-12 sparse checkpoint | Repeated results identical; checkpoint and opening replay of month 13 match final detail state/runtime without duplicate claims or interest |
| Distinct owners / equivalent generic Expense | Reject another household's bank proof; replace source-proven equivalent generic expense with C1 stream | No cross-household account or claim leakage; exactly one premium recognition/settlement and unchanged full joint result |

P22 independently requires contractual debt service before optional extra
principal. For **funded** baseline and replay runs, this synthetic household
**explicitly authors** the additional same-instant priority: wage settlement
before debt service, debt service before insurance expense settlement, and
insurance expense settlement before extra principal. The source-qualified
synthetic policy makes replay and summary/detail comparisons deterministic
without inventing a global finance-engine priority; it is NOT implied by P22
or a universal rule for other households. The same-day wage case separately
authors VS2 `income_before_expense`. Amounts in the January and February
oracle are unchanged by the admitted order.

For the $400 and $100 **scarcity** cases the scenario explicitly selects the
original **empty** cross-domain policy instead: no implicit priority is allowed.
At $400 competing payment orders are economically material and execution must
stop atomically with `HOUSEHOLD_CONTENTION_UNRESOLVED`; at $100 both payments
fail in every legal order, so actual unpaid claims/shortfalls can be asserted.
The later wage cannot fund an earlier obligation. This split preserves both
important product contracts: deterministic replay with an authored policy
and conservative incompleteness when policy is absent and order matters.

The $100 case reports potential funds of $100 and deficits of $200 / $344.24
in the existing shortfall objects. Both accepted funding amounts are zero:
potential funds are diagnostic availability, not posted partial settlements.

## Honest unsupported boundaries / audit handoff

The exact transaction allowlist, single checking account, empty positions, exact
three-liability inventory, absent tax legs and absent output-capability claims
are negative assertions. A pending SSA route is rejected by the C1 attachment
with incomplete coverage and no admitted operation; the original kernel survives.

| Excluded/unresolved boundary | What this evidence does not claim |
| --- | --- |
| C2 SSA premium withholding / Medicare | No SSA deduction, benefit netting, Medicare or IRMAA settlement |
| C3 FSA reimbursement | No FSA payroll debit, reimbursement income or bank credit |
| Series EE / TIPS noncash tax | No phantom bank cash, invented tax payment, holdings or basis update |
| A4 requested RMD without a posted withdrawal | No withdrawal input/participant or retirement account is admitted; no posted distribution or satisfied RMD is inferred from a logical request |
| HELOC draw | No borrowed cash or new line liability |
| 529 | No education distribution, contribution, tax benefit or asset account |
| Missing wage withholding; #101 tax | $1,000 is the explicitly modeled deposit/recognition only; no full after-tax net-cash, tax settlement, withholding sufficiency or D2 coverage status |

`completed` describes only the admitted gross economic operations. C1 attachment
coverage is not household forecast/tax completeness. ChatGPT audit should inspect
the exact seven January transactions, recognition/claim/settlement identities,
the explicit required/optional service split, atomic scarcity outcome, fixture
flags and unsupported boundaries. CI owns architecture, typecheck, unit/build
and the existing four E2E shards; this directory adds no browser or stress suite.
Any actual combined-executor accounting mismatch requires a follow-on V3 under
the same #149 owner with narrowly identified shared paths; never adjust the
oracle or insert an alternate ledger to conceal it. Refs #149.

## #149 S8-2 combined canonical baseline

The S8-1 files and exact oracles above remain unchanged and independently
runnable. `combinedScenario.ts`, `combined.test.ts`, `combinedReplay.test.ts`
and `combinedPortableWorker.ts` add a test-only composition on merged main
`d1c03533` (#209 FSA, #210 J1, #211 card, #208 canonical shared writer).
Refreshed `origin/main` equaled that starting commit; #209's accepted head
`385db529` was merged by the PM. The only open PR at initialization was #207
(U1B), outside this test subtree. J2/#204 remains a separate owner boundary.

The composition keeps VS2 wages, the VS4 auto contract and C1 premiums from
S8-1. Twelve source-confirmed premium months and optional instructions cover
2026 only. The 13/25-month runs extend the same real kernel, continuing the
explicit recurring wage and contractual debt behavior; they do not invent
2027/28 premium documents or future issuer/FSA plan years. The as-of/cutoff is
December 31, 2029, so all separately dated synthetic actual-payment confirmations
are available for this historical scenario. Publication instants remain their
actual source instants, not rewritten to the run date.

FSA employer/medical/BANK facts are authored here with a $2,000 election, no
payroll contribution and one $1,000 paid qualified medical receipt. Pure FSA
evidence/provenance builders are reused; the full household-scoped raw plan,
receipt, approvals and BANK confirmations are constructed independently.
The existing issuer documentary builder supplies its $1,000 opening principal,
$20 January interest, $25 minimum and approved $200 split ($20 interest/$180
principal). Ownership and actual $1,900 BANK opening at settlement are explicitly
bound to this household. Both production adapters re-evaluate their raw source
requests and use the canonical writer. No mock receipt authority is installed.

J1 is explicitly a **test-only canonical writer client**, following #210's
structural journal contract. Its independently supplied $500 ordinary pretax
cash distribution debits an owned $1,000 retirement cash account and credits
the owned BANK on January 22. No J2 integration, RMD calculation, obligation
satisfaction, withholding or tax settlement is inferred. The journal always
says `rmdSatisfaction: "not_applied"`, `tax: "incomplete"`; allocation rows are
empty. This is a structural transfer baseline, not funded-RMD acceptance.

### Independent fixed USD truth table

Opening BANK is $2,000, retirement cash $1,000, auto principal $5,000 and card
principal $1,000. Opening assets are $3,000, liabilities $6,000 and NW −$3,000.
These are literal oracles authored independently of production calculators.

| Actual dated event | BANK after event | Other accounting consequence |
| --- | ---: | --- |
| Jan 5 00:00 UTC — wage +1,000 | 3,000 | Wage income 1,000 |
| Jan 10 12:00 — funded medical payment −1,000 | 2,000 | Medical expense 1,000; canonical original archived |
| Jan 15 00:00 — premium −300 and auto −500 | 1,200 | Premium expense 300; interest 50; required principal 394.24; extra principal 55.76; loan 4,550 |
| Jan 22 12:00 — J1 owned cash transfer +500 | 1,700 | Retirement cash 500; consolidated assets/NW unchanged by transfer |
| Jan 31 17:00 — issuer interest recognition | 1,700 | Card liability 1,020; expense 20, recognized once |
| Feb 5 00:00 — wage +1,000 | 2,700 | Wage income 1,000 |
| Feb 15 00:00 — premium −300 and auto −500 | 1,900 | Interest 45.50; required principal 398.74; extra 55.76; loan 4,095.50 |
| Feb 15 17:00 — issuer BANK payment −200 | 1,700 | Card liability 820; no second expense |
| Feb 16 12:00 — independently confirmed FSA deposit +1,000 | 2,700 | Expense credit 1,000; no earned income, payroll or tax credit |

January closes with assets/cash $2,200 (BANK $1,700 + retirement $500),
liabilities $5,570, NW −$3,370, income $1,000 and expenses $1,370. February
closes with assets/cash $3,200, liabilities $4,915.50, NW −$1,715.50,
income $1,000 and net expenses −$654.50. The restricted $1,000 remaining FSA
entitlement is excluded from net worth. Both interest/premium payables are zero.
There are exactly 10 January and 9 February transactions, each balancing by USD.

Exact canonical archive IDs are `card-charge-january`, `card-payment-february`,
`fsa-cash:s8-medical-source:original`, `fsa-cash:s8-medical-source:deposit` and
`s8-retirement-posted`. Actual shared receipt IDs are
`card-bank:payment-february` and `fsa-cash:s8-medical-source:receipt`.
The tests compare those receipts with independently requalified source output
and compare each writer proof with its actual kernel transaction.

### Failure and replay evidence authored for CI

| Case | Required outcome |
| --- | --- |
| Zero BANK, payday after original medical payment | All-or-nothing failure; no committed period, receipt, proof or posting; future reimbursement cannot fund original |
| Real VS2 payday at FSA's instant, participant arrays forward/reversed | Reject unrelated BANK work; preserve exact opening; neither participant order nor the S8-1 contention policy authenticates a cross-source sequence |
| FSA original/deposit same instant | Reject unsigned; admit the provider's signed sequence with exact intermediate BANK confirmations; retain every participant's result |
| Backdated actual original, unavailable source publication | Reject original period atomically |
| Missing approval or mismatched deposit owner | Preserve full January; reject February without retaining its wages, debt service or issuer payment |
| Late February exception after both settlements | Roll back entire February state, journal, receipt, proof and primitive runtime; retain exact independently executed January |
| Changed approval/source or missing issuer after commitment | Typed incomplete/error; physically posted historical BANK $2,700 and immutable archives remain intact; no complete capability is asserted |
| Wrong BANK ownership | Entire combination rejected before committed period |
| Recomputed-integrity wire changes to receipt, approval, journal, proof, retirement record or RMD marker | Restore rejects from canonical/source evidence rather than trusting a caller-supplied checksum |
| 13/25 months, summary versus detail | All periods and statements equivalent; exact receipts/proofs; each new domain posting occurs once |
| Portable v3 | One checkpoint at month 12, two at months 12/24; second checkpoint has empty receipt/proof/J1 deltas |
| Fresh child process, raw providers independently reconstructed before artifact decoding | Exact January, February and final-window replay; whole state/period equality; all three providers actually consulted |
| Missing or altered FSA/issuer, altered J1, independent provider read failures | Portable restore rejects; no artifact-driven source authority |
| Missing J1 authority at late checkpoint replay | Preserve physically posted cash and structural journal; still not_applied/tax incomplete |

For the funded case **overall forecast status remains `incomplete`**: this is
required because `fsaPayrollTax` and `cardFutureCycles` remain incomplete.
Successful admitted execution is asserted by every requested period committing
and by absence of error diagnostics, not by weakening those coverage statuses.
`fsaCashSettlement: complete` refers only to the one actual fully reimbursed
receipt. Wage income remains exactly $1,000 per modeled month. Gross-to-net
payroll, income/payroll taxes, medical deduction coordination, future card
cycles, broader B/A/C integrations, UI coverage and #120 UAT remain unproved.

No local verification was executed by Codex. GitHub CI must establish typecheck,
architecture, unit/build, verification and all existing E2E shard results;
this suite adds no browser tests or 649-month performance workload. ChatGPT
must independently audit the exact PR head and update #149, which remains open
for S8-3 after separately audited J2, remaining domains, tax and UAT.
