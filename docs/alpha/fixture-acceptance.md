# Alpha synthetic-household library (eight linked-family multi-plan models) — build/acceptance contract

**Companion:** [Seven household blueprints](household-blueprints.md), [monthly category matrix](monthly-category-matrix.csv), [GitHub Issue #108](https://github.com/bensmullen/personal-finance-app/issues/108). **Status:** planning/reference only, NOT a PFM_TASK_V3 Codex issue and NOT implementation evidence.

## Dataset contract
- Eight stable versioned fixture names `H01`–`H08`, deterministic seed per person/account/transaction/holding/lot, reference as-of 2026-10-01, last 24 complete history months 2024-10-01 to 2026-09-30; forward plans 2026-10 onward.
- Generate actual *canonical* model records, not static presentation slides. Each has members, relationships, employments/compensation, tax-residency facts, properties, assets, liabilities, holdings, positions/lots, transactions, benefits, insurance, effective-dated expenses, contribution instructions, annual events and scenario/plan alternatives.
- Model values are invented illustrative anchors: no source implies actual broker holdings, 2026 quotes, verified real estate comps or tax-law rates. Exact figures and balances must be reconciled after applying authoritative funding/tax/amortization.
- Target **at least 24 ordinary monthly expense categories** per household unless economically inapplicable (zero positions/investments deliberately required in H04). See 43 category entries, including special posting types, in CSV. For each active category generate seasonality, at least 3 merchant labels, a mix of routine and irregular actual-looking transactions where appropriate, plus clear payer/owned-account routes. These are design targets, not a preexisting data file.
- History should have *hundreds of transaction events per household* (with exceptions when legitimately sparse), not one aggregate category row per month; include credit-card purchase/settlement, check/payroll, insurance premium, scheduled amortization and interest/principal, rental net-of-vacancy, dividends, security purchases, employer match, sweep/reinvestment and transfer identities. Do not falsely generate a 24-month posting history for periods a person/account had not opened.
- Current investment holdings: H01 55–75 positions / 400–700 dated tax lots, H02 0–3 liquid investment positions / few lots, H03 30–45 / 220–320, H04 **0 / 0**, H05 5–8 / 16–30, H06 8–12 / 35–60, H07 14–20 / 90–150, H08 32–42 / 180–300. Each account has independent positions and separate cash balance; aggregates reconcile. Lot coverage should include specific-price purchases, dated DRIP acquisitions, subsequent sell/partial sale, short- and long-term holding periods where supported.
- Add one structured coverage manifest per fixture: counts of people/accounts/assets/loans/positions/lots/actual transactions/events, supported vs partial vs unsupported model features; provenance=synthetic; named income vs spending, account/holding and liability sums, year-by-year cash reconcile and dated diagnostic inventory.
- Preserve `observed_synthetic` vs `authored_projection` vs `scenario_intent` concepts: household scenario decisions must not rewrite historical transactions.

## Normalized monthly-category CSV rules
- Each money cell is a **design-level average monthly economic cost**, not necessarily a monthly **posting**. Annual/seasonal entries must be assigned specific installment dates; payroll deductions never appear twice as consumer expenses.
- `expense` = outlay reducing cash and net worth on recognition/payment schedule.
- `rental_operating_expense` = property-scoped outlay; future rental tax recognition (deductions/depreciation) separately capability-gated.
- `transfer_reserve_not_expense` = transfer from one owned account to another; affects account liquidity, not household-level spend.
- `property_tax_expense_actual_installments` = expense via actual paid schedule; never simultaneously recreate same payment in escrow and cash ledger.
- `insurance_expense_no_escrow_duplication` = premiums attributed once, even if mortgage escrow finances payment.
- `seasonal_expense_monthly_equivalent` = annual budget normalized to 12 months; actual history/forecast concentrated in realistic months.
- `expense_excludes_payroll_premiums` = out-of-pocket medical spending only; payroll medical premiums flow through paystub and/or direct pay as distinct payment sources.
- `expense_or_529_qualified_distribution_not_both` = expense beneficiary vs 529 funding/basis never counted as two purchases.
- `expense_or_transfer_to_external_party`, `expense_or_gift` = true external transfers from household; cross-owned-account transfers remain transfers (tax deduction separate).
- `payroll_deduction_not_expense_duplicate` = withhold from paycheck and characterize as dues; never reduce net pay again.
- `derived_from_debt_schedule_no_manual_duplicate` = derive loan interest from authoritative amortization, not matrix count.
- Mortgage payment (P&I), credit-card settlement, HELOC, installment/auto/student-loan repayments, pension payouts, payroll taxes/withholding, 401(k)/HSA deductions, purchases, IRA/brokerage funding, rental income, state/local tax settlement, and Social Security are **not** represented as generic expense matrix rows; source them from their dedicated authoritative financial records.
- Before fixture implementation, review category targets for sustainable vs intentionally insolvent baselines. Specifically **H02 and H06 may have structural monthly deficits** by design; the product must display an explicit shortfall with dates and source rather than inventing borrowing, overdrafts, account sales or unexplained cash. Tune numeric anchors only if necessary to preserve internally realistic financial history, keeping stress outcome and persona identity.

## Required test/coverage examples
1. H01: social security/pension/RMD and taxable distributions don't triple count; multiple property ownership does not imply income; estate/gift projections capability-gated; wealthy liquidity reconciles.
2. H02: four independent amortizing mortgages, escrow vs property taxes, 3 rental cash flows and vacancies, separate grandma/child cash, pension not 401(k), credit debt & shortfall; no assumed grandparent-income pooling.
3. H03: employer stock vs ETF diversification, vested vs unvested compensation, 401(k) Roth/traditional rules, mortgage, after-tax paychecks, employer concentration and stock tax gaps.
4. H04: user never invested, clean zero state, meaningful forecast without investment entries; retirement contribution is only created by an explicit what-if.
5. H05: payroll-only 401(k), checking-funded Roth IRA, union benefit vs due, seasonal overtime, move-out scenario.
6. H06: NYC resident income-tax applicability, salary/bonus withholding, student loan interest/payment, high rent, expense splitting of client reimbursements.
7. H07: geographic work facts not inferred from mailing address, auto vs mobile-home insurance, seasonal ski spend, funded investment purchases and van debt.

### Negative tests
- Re-run same fixture seed -> identical canonical data/result fingerprint.
- Re-import/clone demo into personal namespace -> no duplicate owned accounts/transactions; no cross-demo IDs.
- Unsupported tax or domain feature -> incomplete or explicit scoped diagnostic, not a silent plausible-looking number.
- Missing basis/lot history -> show missing coverage, do not invent.
- Unfunded payment -> shortfall, not auto-overdraft/auto-liquidation.
- Card spending plus payment -> exactly one economic expense.
- Investment account market value and positions/cash -> no double counting in net worth.
- Current dated property/rental-income ownership and parent-child household membership -> no wrong cash ownership.
- Data privacy: synthetic only; not derived from genuine account numbers, names, residences or documents of actual people.

## User-facing acceptance
- Entry point labeled **Explore an example** on onboarding and in an easily discoverable menu.
- Eight persona cards with succinct description and *why this matters*, with believable opening financial metrics and a one-click load. No manual setup or external provider.
- **Guided “try this” questions** for each household (three defined in blueprint). Clear summary-first money flow, account/holdings, debt, tax, retirement and what-if screens, progressive disclosure of dense history.
- Distinguish read-only sample vs editable personal copy; confirm a copy/reset/switch never affects another person or live financial data.
- Show available forecasts within suitable runtime budgets; disclose features not modeled / tax jurisdiction not supported. No fabricated fully detailed retirement/estate recommendation when incomplete.
- Product-owner UAT with diverse testers; capture time-to-first-useful-forecast, number of interactions, understanding of each persona's cash flows, unsupported-value confusion and ability to make one meaningful what-if. Follow existing O1 measurement policy to set acceptance target after measured dry runs.

## Dependencies / boundaries
- Advance authoring/specification as isolated docs while U1 #94 continues. Do **not** implement shared financial authoring in parallel or present fixture docs as merged code.
- Build canonical fixture factories after audited merged D1 and D2 relevant domain mechanics, with single owner of shared engine/editor. Retire temporary placeholders only when supported semantics replace them.
- Related authority: `docs/specs/capabilities/data-onboarding-and-import.md` (PFA-ONB-001–013), `docs/specs/roadmap/post-pr21-implementation-roadmap.md` (O1/R11), `docs/development/verification-policy.md`. Existing performance fixtures and Golden Household stay independent.
- Financial-engine support status must be verified per scenario at implementation time; planned features such as complex rental/estate tax do not become correct simply because a fixture contains those facts.

## Eight-household multi-plan and family acceptance addendum (2026-10-11)

**All eight, not seven.** H08 is the Denver age-60/61 couple with an adult child whose disability-related support needs continue for life. Starting combined assets $5.28m, mortgage $280k and **net worth $5.00m** (including $1.35m owner-occupied home). Include explicit health insurance/Medicare timing, Avery's care and income/benefits ownership, retirement 62/65/67 choices, parent death/survivor and benefit/trust capability disclaimers. Do not silently count Avery's independent cash in parental wealth.

**Family population:**
- H01 contains Eleanor/Martin, all three financially independent adult children, their partners and five grandchildren; each family branch has wages, properties, relevant liabilities, payroll deductions, insurance, holdings, budgets, and appropriately scoped 24-month synthetic histories. Keep distinct owner-households and consolidated family view explicitly elective; beneficiary transfers represent outflow and inflow only when events happen.
- H02 contains both parents, co-resident Elena, part-time-working Sofia, younger Mateo and Isabel as six complete person records with their own appropriate income/assets/expenses, separate Medicare/health insurance and education goals. Parent ownership of property and pension cannot silently absorb grandparent/teen cash.
- H03 baseline childfree but **two children are created as future planned births** only in the appropriate plan; make childcare, parental leave, healthcare and 529 contributions materially affect those scenarios, without contaminating baseline.
- H08 contains Marisol/James/Avery with separate care and funding responsibility; discuss special-needs trust, ABLE/SSI/Medicaid, legal decision-making as **unsupported** unless authoritative law/benefit semantics exist.

**Plans required:** every fixture independently saves **status quo + at least three meaningful, named alternatives**, with H03 & H08 richer cases. See [explicit plan IDs and changes](household-blueprints.md#comparable-saved-plans-mandatory-for-each-of-the-eight-households). Plan comparison includes goals/assumptions/effective dates/member changes, assets/debt/benefits/insurance impacts, named funding accounts, and aggregate outputs for the same date/horizon/Forecast Basis. Scenario alternatives are not aliases or merely labeled UI filters. Plans must survive reload and not mutate the original state; any capability-limited plan can still be shown with clearly isolated, incomplete metrics. Align integration with existing independent-plan persistence owner **Issue #105**; don't allow #108 to reimplement conflicting plan cloning semantics.

**Performance and verification:**
- Representative deterministic history/current-state reconciliation on all 8 is appropriate for bounded normal CI; long-horizon and full multi-plan stochastic/performance stress loads belong to engineering-validation following existing verification policy.
- Validate plan invariants via independent IDs, disabled future events in baseline, provenance/ownership preservation, no stale plan data after reset, exact per-member/account economic transfers, comparisons only across genuinely comparable forecast bases and clear unsupported diagnostics.
- Test H08 high ongoing care, pre-65 employer coverage, Medicare transition, dependent benefit vs eligibility unknown, care cost events and survivor scenario without asserting unimplemented probabilistic or trust-law accuracy.
- Verify an uncoached tester can open any of 8, see **at least 4 choices**, load a choice, understand how outcome differs, switch back without losing state, and obtain a correct or explicitly incomplete forecast with no manual data-entry. The first *usable supported* forecast remains required: an entirely disabled dashboard is not a passing sample.

**Scope separation:** This PR authors source data **only**. Future implementation should be broken into bounded fixture factory + plan persistence integration + approachable exploration UI (and UAT), with existing U1/D2/P1 owners respected. No claim of 3–6 elapsed engineering weeks; estimate the concrete scope only after inspecting current fixture factories, plan-clone implementation, supported finances and UAT failures.
