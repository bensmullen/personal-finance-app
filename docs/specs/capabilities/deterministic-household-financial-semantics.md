# Deterministic Household Financial Semantics Readiness

**Version:** 0.3.2-draft  
**Status:** Pre-stochastic/private-alpha gate  
**Requirement prefix:** PFA-DET

## 1. Purpose

This specification defines the deterministic household-financial behaviors that must be complete, user-authorable, and independently testable before stochastic household modeling begins.

It is a cross-domain readiness contract, not a replacement for the canonical schema or executable financial semantics. Exact accounting, timing, funding, tax, and state-transition behavior remains owned by the higher-authority financial specifications and the applicable tax, investment, insurance, and liability capabilities.

The product SHALL prove these behaviors deterministically first so Monte Carlo execution does not multiply ambiguous inputs, unsupported fields, or incorrect financial relationships across thousands of realizations.

## 2. Core readiness principles

### PFA-DET-001 — User concept to executable calculation contract

Every normal-user financial input exposed for the private-alpha deterministic model SHALL map to a defined executable financial meaning.

For each material field or authoring action, the implementation SHALL identify whether the value is:

- an authoritative household fact;
- a planning assumption;
- an explicit decision/policy;
- a creation-time immutable fact;
- a derived value; or
- an unsupported capability.

A normal editor SHALL NOT expose a field as freely editable when the engine ignores it, rejects it, silently preserves another value, or requires an undeclared rate/frequency/timing basis.

Derived values SHOULD be calculated rather than redundantly requested when the necessary authoritative inputs already exist and the derivation is unambiguous.

### PFA-DET-002 — Funding-source semantics are explicit

Transfers, contributions, purchases, debt payments, premiums, and other cash-consuming operations SHALL identify their authoritative funding source and SHALL NOT be modeled as generic expenses merely because cash leaves one account.

For the initial private-alpha supported authoring contract:

- employee traditional 401(k), Roth 401(k), after-tax 401(k), and HSA contributions are payroll-sourced only;
- IRA contributions, taxable-brokerage purchases, Treasury purchases, CD purchases, and other ordinary personally funded investments are funded only from explicitly selected checking or savings accounts;
- unsupported funding sources or rollover/conversion paths SHALL be rejected or capability-gated rather than inferred.

These are product-scope constraints for the initial alpha, not claims that other real-world funding paths never exist.

### PFA-DET-003 — Workplace retirement and HSA contribution mechanics

The deterministic household model SHALL support payroll-sourced employee contributions to:

- traditional/pre-tax 401(k);
- Roth 401(k);
- after-tax 401(k); and
- HSA accounts.

Contribution amount/rate, payroll timing/frequency, applicable limits/rules, cash-pay reduction, account increase, tax recognition, and lineage SHALL remain distinct.

Traditional/pre-tax, Roth, and after-tax contribution character SHALL remain distinct through payroll and tax calculation. The engine SHALL NOT assume that all retirement contributions reduce the same taxable bases. Any applicable income-tax versus payroll-tax treatment must come from the authoritative tax rules for that contribution type.

A contribution SHALL NOT be double-counted as both household spending and an investment purchase.

Employer 401(k) matching/non-elective contributions and employer HSA contributions SHALL be modeled as employer-funded allocations: they increase the destination account/position without reducing employee cash pay, while still participating in the applicable combined statutory limits and tax characterization.

Applicable effective-dated employee, employer+employee, HSA, and IRA contribution limits/catch-ups SHALL be calculated from authoritative rule data and household facts rather than manually entered as magic constants.

### PFA-DET-004 — Retirement-account conversions and IRA semantics

The deterministic model SHALL support:

- traditional IRA accounts;
- Roth IRA accounts;
- user-funded IRA contributions from checking/savings under the private-alpha funding contract;
- traditional/Roth withdrawal and distribution distinctions where material;
- in-plan conversion of eligible traditional/after-tax 401(k) balances to Roth 401(k) as an explicit conversion event/operation; and
- associated tax recognition and basis/character tracking required by the supported tax rules.

A conversion is not household consumption and SHALL NOT be represented as an ordinary expense. Asset movement, tax recognition, and any cash tax settlement SHALL remain separate.

D1 SHALL also support a bounded but advanced rollover contract covering eligible direct trustee-to-trustee/plan-to-plan rollovers, pre-tax versus Roth destination compatibility, preservation/splitting of after-tax basis, and supported indirect-rollover timing/withholding/frequency restrictions. A rollover is not household consumption or earned income. Unsupported plan-specific/inherited/RMD/corrective/other specialized cases SHALL produce explicit capability diagnostics.

### PFA-DET-005 — Taxable brokerage account mechanics

Taxable brokerage accounts SHALL support deterministic:

- cash funding from checking/savings;
- purchases and sales;
- security/position quantity and basis;
- realized gain/loss;
- unrealized valuation changes;
- dividends and interest;
- cash distributions and reinvestment where supported; and
- applicable tax-character facts.

Household aggregation SHALL count each economic resource exactly once and SHALL NOT double-count account totals plus their underlying cash/positions.

### PFA-DET-006 — Cash accounts and deposit interest

Checking and savings accounts SHALL support opening/current cash balances plus deterministic credited interest where configured.

Interest SHALL use an explicit rate basis, compounding/accrual convention, crediting schedule, and tax character. The product SHALL NOT infer a compounding basis from a bare percentage field.

Interest credited to an account increases cash and produces the applicable interest-income/tax recognition rather than being treated as an external transfer.

### PFA-DET-007 — Treasuries, bonds, and certificates of deposit

The deterministic model SHALL support a defined private-alpha subset of fixed-income/deposit instruments covering:

- Treasury bills and supported Treasury/bond positions;
- certificates of deposit;
- purchase/funding;
- principal/par or deposit amount;
- maturity;
- coupon/interest or discount/accretion semantics as applicable;
- scheduled interest/coupon cash settlement;
- principal repayment/redemption at maturity;
- sale before maturity when that instrument path is supported; and
- applicable basis, realized gain/loss, and tax-character facts.

The model SHALL distinguish return of principal from income. Unsupported callability, floating-rate, default, early-withdrawal, or complex bond features SHALL be capability-gated. TIPS and Series EE savings bonds are governed by the D2 breadth requirements below rather than treated as generic unsupported fixed income.

### PFA-DET-008 — Mortgage lifecycle

Private-alpha deterministic liability support SHALL include:

- ordinary fixed-rate mortgage amortization;
- principal and interest separation;
- scheduled payments funded from an explicit cash account;
- extra principal payments;
- payoff behavior; and
- refinance as an explicit transaction/event that closes or replaces the old obligation and establishes the new one without double-counting principal or cash.

Refinance cash-out, points/fees, closing costs, escrow, variable-rate, recast, or other features SHALL be supported explicitly when modeled or capability-gated when omitted.

### PFA-DET-009 — Cryptocurrency and option positions

Cryptocurrency SHALL be representable as an investment asset class with explicit quantity, price/value, purchases, sales/disposals, basis, realized gain/loss, and tax-character facts. It SHALL NOT be silently treated as diversified equity.

Before private alpha, options SHALL have a deliberately bounded deterministic contract. Any supported option position SHALL define the economic meaning of premium/cost, quantity/contract multiplier, underlying reference, expiration, and the supported sale/exercise/assignment/expiration outcomes required for that position type.

Unsupported option strategies or contract mechanics SHALL be rejected/capability-gated rather than approximated.

### PFA-DET-010 — Dividends, interest, gains, and reinvestment

The deterministic investment model SHALL distinguish at minimum:

- interest income;
- ordinary/non-qualified dividends;
- qualified dividends when supported;
- short-term realized capital gain/loss;
- long-term realized capital gain/loss;
- unrealized gain/loss; and
- return of principal/capital where modeled.

Dividend reinvestment SHALL be represented as two linked economic effects: dividend recognition/settlement followed by an investment purchase. Reinvestment SHALL NOT erase income recognition or create duplicate household cash flow.

Holding-period and tax-character decisions SHALL be sourced from explicit transaction/lot/timing facts and applicable tax rules, not inferred from the display label of an investment.

### PFA-DET-011 — Insurance premiums and deterministic benefits

Before stochastic insurance-event modeling, the household engine SHALL support the private-alpha deterministic insurance floor:

- explicit policy premium/cost schedule funded through authoritative household cash flow;
- policy/coverage effective period;
- explicitly scheduled or scenario-triggered benefit/payout events for supported stress cases;
- payout settlement to the appropriate account/beneficiary; and
- applicable tax/cash-flow/accounting classification.

A premium is an expense/cost according to the supported policy contract. A benefit is not ordinary earned income unless the applicable tax/accounting rule says so.

Unsupported claim adjudication, carrier behavior, probabilistic frequency/severity, or policy-family mechanics SHALL be capability-gated.

### PFA-DET-012 — Tax treatment is part of the deterministic truth model

Before stochastic modeling, deterministic fixtures SHALL prove the applicable tax treatment for the supported private-alpha cases, including:

- short-term and long-term realized capital gains/losses;
- taxable interest;
- ordinary and qualified dividends;
- traditional and Roth retirement contributions/distributions;
- supported 401(k) Roth conversions;
- HSA contributions/distributions where material;
- taxable brokerage activity;
- Treasury/bond/CD interest and disposition treatment where supported;
- cryptocurrency dispositions; and
- supported option outcomes.

Tax-dependent outputs SHALL remain incomplete when the applicable target-jurisdiction tax semantics are missing. A missing tax rule SHALL never be treated as zero tax.

### PFA-DET-013 — Deterministic truth-table verification

Each required use case SHALL have deterministic verification with independently stated expected economic effects, not only snapshot or implementation-internal assertions.

The minimum pre-stochastic fixture matrix SHALL include:

1. traditional 401(k) payroll contribution;
2. Roth 401(k) payroll contribution;
3. after-tax 401(k) payroll contribution;
4. employer 401(k) match and non-elective contribution;
5. HSA employee payroll contribution;
6. employer HSA contribution;
7. automatic 401(k)/HSA/IRA annual and catch-up contribution-limit calculation, including applicable combined employee/employer limits;
8. in-plan Roth conversion;
9. direct Traditional/pre-tax retirement rollover;
10. Roth retirement rollover;
11. mixed pre-tax/after-tax rollover preserving basis/character;
12. at least one supported indirect-rollover case;
13. traditional IRA contribution;
14. Roth IRA contribution;
15. taxable brokerage purchase/sale;
16. ordinary mortgage amortization;
17. mortgage extra principal payment;
18. mortgage refinance;
19. checking/savings interest credit;
20. Treasury bill/bond interest plus principal maturity behavior;
21. CD interest plus maturity principal;
22. cryptocurrency purchase/sale;
23. insurance premium plus deterministic payout/stress event;
24. at least one supported deterministic option lifecycle;
25. short-term versus long-term gain treatment;
26. interest and dividend tax-character treatment;
27. dividend reinvestment; and
28. funding-source enforcement proving payroll-only versus checking/savings-only paths.

For each case, verification SHALL reconcile the applicable beginning state, recognized income/expense/gain/tax facts, transfers/contributions, cash settlement, asset/liability change, ending state, and no-double-counting invariants.

At least one combined realistic-household fixture SHALL exercise multiple cases together to detect cross-domain interaction errors that isolated unit tests cannot reveal.

### PFA-DET-014 — User-authoring and diagnostic integrity

Normal authoring SHALL use financially recognizable concepts and SHALL prevent or clearly gate unsupported configurations before the user relies on a forecast.

The UI SHALL:

- distinguish account containers, investment positions, and standalone property/assets;
- prevent unsupported funding-account choices where the valid set is known;
- avoid asking for redundant inputs that can be derived safely;
- expose rate units/bases/frequencies when economically material;
- make creation-only facts explicit rather than pretending later edits will apply;
- explain unsupported capabilities in user-action language; and
- keep compiler codes/UUIDs in technical detail rather than primary guidance.

The shared normal-user authoring contract in PFA-UX-015 through PFA-UX-020 is an explicit D1 usability acceptance dependency. D1-C's passed computational/semantic checks are not equivalent to accepted D1 authoring UAT. U1 is a usability recovery/acceptance slice over the original D1 semantics; it does not add D2 economic capabilities.

### PFA-DET-015 — Stochastic and private-alpha gate

D1 closeout is defined by the original PFA-DET-001 through PFA-DET-014 contract, D1-C deterministic semantic integration, and accepted task-based authoring UX/UAT under U1/PFA-UX-015 through PFA-UX-020. D1-C financial-semantic implementation may merge independently before UX acceptance without declaring the D1 gate complete. D1 does not require D2 capabilities to already exist. D2 closeout is separately defined by PFA-DET-016 through PFA-DET-023. PFA-DET-015 is the combined D1+D2 gate for stochastic runtime, not an additional scope of financial instruments inside D1.

R5 stochastic runtime implementation SHALL NOT begin until both D1 and D2 deterministic readiness contracts are complete and verified. None of the named D2 ordinary instrument/benefit families may be omitted merely because an initial private-alpha participant does not use them. Isolated calibration, planning, import, or other foundation work that cannot alter, assume, or execute stochastic household semantics may proceed earlier.

R6/R7 probabilistic household work SHALL NOT begin from an implementation state that bypasses this gate, and probabilistic household results SHALL NOT be treated as product-complete unless the deterministic gate remains green.

Private-alpha launch additionally requires these supported use cases to be authorable through the intended onboarding/editor paths and included in representative UAT, with unsupported subfeatures explicitly capability-gated.


### PFA-DET-016 — Social Security and defined-benefit pension income

Before stochastic household modeling begins, the deterministic model SHALL support materially common retirement-income sources beyond account withdrawals.

The supported Social Security floor SHALL include retirement, spousal, and survivor benefits with explicit claimant/beneficiary identity, claiming/start date, effective-dated benefit rules or an authoritative user/imported benefit estimate, claiming-age adjustments where applicable, COLA treatment, household coordination, and applicable tax characterization. The model SHALL NOT treat Social Security as an arbitrary generic income stream when benefit eligibility or household coordination changes the result.

The supported pension floor SHALL include a basic defined-benefit contract with participant and beneficiary identity, commencement date/age, quoted benefit or supported formula inputs, payment frequency, COLA when applicable, survivor continuation/election where authored, termination/death behavior, and applicable tax characterization. Unsupported plan-specific elections or actuarial options SHALL be capability-gated rather than guessed.

### PFA-DET-017 — Expanded workplace and self-employed retirement-plan families

Before stochastic modeling, the deterministic retirement model SHALL support ordinary authoring and execution for:

- 403(b) plans;
- governmental 457(b) plans;
- the federal Thrift Savings Plan (TSP);
- SEP IRAs; and
- SIMPLE IRAs.

For each admitted plan family, the model SHALL preserve the plan-specific contribution source, employee/employer character, effective-dated statutory limit scope, tax character, rollover/distribution compatibility, and ownership/account identity required for a correct household forecast. Specialized plan elections or uncommon catch-up provisions MAY remain capability-gated only when the ordinary supported contract is explicit and the affected output is marked incomplete.

### PFA-DET-018 — Roth conversion, backdoor Roth, and mega-backdoor mechanics

Before stochastic modeling, the deterministic model SHALL support:

- Traditional IRA to Roth IRA conversion as an explicit non-consumption conversion;
- a bounded backdoor Roth path using nondeductible Traditional IRA contribution/basis followed by Roth conversion, including the applicable aggregate IRA/pro-rata basis rule;
- a bounded mega-backdoor path using after-tax workplace-plan contributions followed by supported in-plan Roth conversion or eligible rollover to Roth, while preserving previously taxed basis and statutory annual-additions limits.

These paths SHALL preserve source/destination identity, pre-tax versus after-tax basis, contribution versus conversion character, applicable limit usage, tax recognition, and separate tax settlement. Plan support and legally material missing facts SHALL be explicit prerequisites rather than inferred.

### PFA-DET-019 — Common consumer and household debt mechanics

Before stochastic modeling, deterministic liability support SHALL include ordinary mechanics for:

- fixed-rate auto loans;
- standard student loans;
- revolving credit-card balances; and
- HELOCs.

The supported contract SHALL model opening/current principal, interest accrual, rate type and effective rate, required/scheduled payments, principal-versus-interest allocation, extra payments, payoff, funding source, and ending liability state. Credit-card and HELOC support SHALL preserve revolving-balance behavior; HELOC variable-rate changes SHALL use explicit rate inputs/rules. Specialized student-loan income-driven repayment, forgiveness, deferment/forbearance, promotional card terms, and unusual HELOC features MAY remain capability-gated until explicitly implemented.

### PFA-DET-020 — Medicare, health-insurance premiums, and health FSA mechanics

Before stochastic modeling, the deterministic household model SHALL represent the recurring healthcare-cost floor that materially changes retirement and working-age cash flow.

The supported floor SHALL include:

- health-insurance premium schedules with covered household members, effective periods, employee/employer share where applicable, and explicit pre-tax payroll versus after-tax funding character;
- basic Medicare premium/cost schedules for the elected/supported Parts and supplements, with age/effective-date eligibility and income-related premium adjustments when materially applicable to the household;
- health FSA payroll contributions, plan-year limits, available balance/reimbursement settlement, and supported carryover or grace-period/use-it-or-lose-it terms when authored.

Detailed medical-claim adjudication, provider networks, prescription formularies, and other unsupported health-plan mechanics SHALL remain capability-gated rather than approximated.

### PFA-DET-021 — TIPS and Series EE savings bonds

Before stochastic modeling, the deterministic fixed-income floor SHALL additionally support:

- Treasury Inflation-Protected Securities (TIPS), including inflation-adjusted principal, coupon calculation on adjusted principal, maturity redemption, and applicable taxable interest/inflation-accretion characterization; and
- Series EE savings bonds, including issue/purchase value, accrual/redemption value, maturity/redemption timing, and applicable federal/state tax character.

Unsupported secondary-market, deferral-election, education-exclusion, or other specialized savings-bond cases SHALL be capability-gated unless the target household requires them.

### PFA-DET-022 — 529 education-savings plans and rollovers

Before stochastic modeling, the deterministic model SHALL support a bounded but real 529 plan contract covering account owner, beneficiary, contributions, investment balance/growth, qualified and non-qualified distributions, applicable earnings/tax/penalty character, and explicit funding/settlement.

The supported rollover floor SHALL include ordinary plan-to-plan 529 rollovers and beneficiary changes where permitted, plus a bounded 529-to-Roth-IRA rollover path using effective-dated statutory eligibility, lifetime/annual limits, account-age/holding requirements, beneficiary identity, and Roth IRA contribution-limit interaction. State-specific deductions, credits, recapture, or plan restrictions SHALL be implemented for the supported jurisdiction or explicitly capability-gated.

### PFA-DET-023 — D2 integrated deterministic breadth verification

The D2 breadth capabilities in PFA-DET-016 through PFA-DET-022 SHALL have independent deterministic expected-effect tests plus at least one combined household fixture spanning retirement income, expanded retirement plans, ordinary debt, healthcare costs, special fixed income, and education savings.

Verification SHALL reconcile cash flow, assets, liabilities, basis/tax character, statutory-limit usage, benefit/premium schedules, rollovers/conversions, and ending net worth without double counting. Normal-user authoring and capability diagnostics SHALL be exercised for each admitted family before D2 closes.

## 3. Scope boundary

This gate requires deterministic correctness and authoring for the named household mechanics. It does not require:

- stochastic return distributions or Monte Carlo execution;
- automated portfolio optimization;
- exhaustive security/product coverage;
- every option strategy or bond feature;
- every insurance product family;
- every specialized tax rule; or
- production bank/brokerage aggregation.

Those capabilities may follow only after the deterministic semantic foundation they depend on is explicit and verified.

## 4. Cross-capability ownership

- PFA-INV owns investment/account/instrument planning and execution refinements.
- PFA-TAX owns tax law, characterization, liability, withholding, and settlement.
- PFA-INS owns policy/coverage/benefit semantics.
- PFA-UX owns user comprehension and editing presentation.
- PFA-ONB owns efficient capture/import of the required facts.
- The executable financial semantics own timing, funding, accounting, state, and invariant authority.

This specification owns the readiness gate tying those capabilities into a testable private-alpha household model.

## 5. PM-approved D2 financial contract and parallel-interface freeze (2026-10-17)

**Authority/status:** This section is the controlled, normative elaboration of PFA-DET-016–023 following the PM's explicit approval of A1–A4, B1–B3 and C1–C3 on 2026-10-17. It resolves product *behavior*, not a claim that any domain is implemented. Earlier non-normative working detail in `docs/development/d2-prep/financial-semantic-decision-proposals.md` supplies rationale but cannot supersede this specification, the executable financial semantics, PFA-TAX, PFA-INV or PFA-INS. If the controlled authorities disagree, stop and synchronize rather than guess. Numeric SSA/IRS/Treasury/CMS law values MUST be retrieved through a verified effective-dated rule snapshot, never from illustration numbers in planning documents.

**Universal D2 invariants (all A/B/C):** D2 uses the existing exact-money, recognition, claim, settlement, identity, funding, tax and projection machinery. No domain-owned parallel accounting engine, universal `income_type` shortcut, phantom funding, duplicated wrapper/holding value, or invisible transfer is permitted. Every admitted action has source evidence or explicit authored terms, valid owner/beneficiary, effective date, economic source/destination, typed operation identity and rule/plan version. Candidate validation and calculation are pure; only the one shared household integrator (#149) may commit atomic funded postings and tax facts. A failed/unsupported operation consumes no cash, account units, tax basis, capacity or benefit entitlement. Supported-before-tax does not imply after-tax completeness: identify the exact affected results and provide source-linked diagnostics. Unknown future law/index/premium/eligibility is not zero, constant extrapolation or a verified future rate.

### 5.1 A1 — retirement and survivor benefits (PFA-DET-016, PFA-TAX-015)

**Social Security:** Represent each retirement, spousal or survivor entitlement as `recipientPersonId`, `workerRecordPersonId`, `benefitKind`, `claimingMonth`, `commencementMonth`, `quote` or verified `ruleSnapshotId`, plus birth/death/marriage/earnings and COLA facts when applicable. The *default authoring path* is a source-qualified, date/dollar-basis-qualified SSA estimate; calculation from earnings/PIA is available only if the law version and all required worker/eligibility facts exist. An estimate already quoted for the actual claiming age MUST NOT receive a second age reduction; a full-retirement-age quote requires a sourced age adjustment. Own retirement and spousal benefits are coordinated with only the eligible excess, not summed as independent full awards. Survivor eligibility/election may replace or coordinate with own benefit after death; never silently pay both in full. Benefit taxation uses authoritative provisional-income treatment, not a flat 85% taxable assumption. Recognize gross award, withheld income-tax credit, Medicare premium deduction, and actual net cash distinctly. Missing eligibility, earnings test, law, or out-of-scope special survivor/divorced/family-max rules marks the affected benefit incomplete; no optimistic fallback.

**Defined-benefit pensions:** Preserve participant, sponsor, joint annuitant/beneficiary, start/stop, frequency, elected form/survivor percent, source quote/formula, COLA terms, mortality scenario and prior-taxed employee basis. Admit a *quoted elected-payment* schedule by default. Compute from a formula only with complete plan-approved service, compensation, accrual, early-start and election terms. A quoted post-election amount cannot be adjusted for the election again. Death stops or changes payments solely under the elected contract; tax facts allocate pretax income and allowed employee investment-in-contract recovery via sourced applicable method. Never invent actuarial rates or survivorship.

### 5.2 A2 — distinct retirement-plan families (PFA-DET-017, PFA-INV-025, PFA-TAX-015)

Admit `403b`, `governmental_457b`, `federal_tsp`, `sep_ira`, `simple_ira` as **distinct source plan families**, with person/employer, active dates, Traditional/Roth/authorized non-Roth after-tax bucket, employee/employer source, compensation, contribution type, plan-specific eligibility/capabilities and law-versioned annual scope. TSP is not a generic 401(k) eligibility alias. The statutory capacity registry uses `personId + taxYear + limitScope + ruleSnapshotId` and preserves shared 401(k)/403(b)/TSP deferral usage where applicable, separate eligible governmental 457(b) capacity, plan annual-additions/employer contributions, and SIMPLE/SEP conditions. Employer additions increase owned assets without household wage-funded cash outflow; pretax/Roth employee deferrals affect pay/tax bases correctly. SEP is employer-funded under its compensation rules; SIMPLE employee deferral, required employer contribution and rollover aging remain distinct. Plan-level after-tax rollover/conversion eligibility defaults to **unknown/not admitted** absent evidence. Uncommon special catch-up, nongovernmental 457(b), SARSEP and unsupported bespoke elections return a typed capability diagnostic. Failed contributions do not consume statutory capacity.

### 5.3 A3 — IRA basis, Roth conversion and backdoors (PFA-DET-018, PFA-INV-026, PFA-TAX-015)

Traditional-to-Roth conversion is a distinct, non-consumption account movement plus separately recognized tax facts; it is neither wages, ordinary IRA contribution nor an RMD satisfying rollover. For each person/tax year, compute Form-8606-applicable pro-rata basis using aggregate Traditional/SEP/SIMPLE IRA basis, applicable year distributions/conversions and the statutory December-31 balance/rollover facts; the tax-year reconciler may finalize conversion tax character only after the year's relevant facts exist. No independent per-account pro-rata calculation or premature monthly final tax assertion. Maintain Roth IRA regular-contribution, converted/rollover (taxable and nontaxable vintage), and earnings ordering/qualification independently.

Backdoor = eligible funded nondeductible Traditional IRA **regular contribution** using IRA contribution/compensation capacity, followed by a separate conversion (possibly a different year). Mega-backdoor = authorized non-Roth after-tax workplace addition using annual additions/plan capacity, followed by an explicitly admitted in-plan conversion or eligible allocated Roth rollover; neither step is a new IRA regular contribution. Proportionally allocate earnings and tax basis for partial distributions, including admissible source-split rollovers; use existing in-plan conversion authority rather than implementing a duplicate tax path. Denied plan eligibility or cash leaves prior state unaltered.

### 5.4 A4 — ordinary distributions, RMDs and funded settlement (PFA-DET-017, PFA-TAX-015)

An ordinary distribution requires account/owner/tax bucket, eligible liquid source or an explicit preceding sale, gross amount or units, date/recurrence, verified bank destination and withholding instructions. The gross source debit, net external deposit and tax-withholding credit reconcile exactly; withdrawn retirement principal is not new income or a second expense. Tax recognition handles pretax/basis, Roth IRA ordering and qualification, eligible plan exceptions and early-distribution rules through the tax owner. Distinguish ordinary distributions, security trades, direct rollovers, conversions and RMD satisfaction by operation kind.

RMD is first a dated **annual obligation** using eligible prior-year balance, birth cohort, authorized life table/beneficiary facts, applicable still-working exception and first-year deadlines. Explicit, eligible *actual* withdrawals may satisfy it; no unsupported auto-sale, invisible bank deposit or rollover of an RMD. Supported automatic compliance is permitted **only after a person authorizes the exact account/liquidation/funding routing**. Unfunded or ineligible satisfaction records a shortfall and affected output incompleteness, not a fictitious satisfied RMD. Include cohort transitions, prior-year December-31 state, the possible two-RMD-year, and exemptions/unsupported inherited-IRA/QCD variants in verification.

### 5.5 B1 — consumer debt contracts (PFA-DET-019)

Existing P22/VS4 supplies the authoritative fixed, nominal-annual/12, monthly, fully amortizing, no-recast, no-capitalization, all-or-nothing **mortgage/auto/standard-student** engine. Family-specific recognition/claim/transaction labeling is required, but a second amortization formula is forbidden. Canonical admission of auto/student into standalone liability forecasts does **not** authorize full combined-household debt integration or user-editable UI. Required service precedes voluntary extra principal; interest, principal, cash, missed service, payoff and net worth reconcile exactly.

Credit cards require issuer-quoted or issuer-formula statement minimums (with dated APR/accrual convention, transaction cycle, grace terms, purchase/refund/payment events and allocation); no invented universal minimum payment. HELOCs require draw availability/line cap, explicit draw authorization, effective rate index+spread, reset dates, caps/floors, draw/repayment phase, interest-only/amortization and balloon/payoff terms. A draw adds equal bank cash and liability, not income; principal service reduces both, and interest is expense. A missing statement quote/index/reset/contract variant cannot be treated as a fixed forever rate. Specialty student IDR/forgiveness, promotions, unusual HELOC features and unsupported capitalizations remain capability-gated, not silently simulated.

### 5.6 B2 — Treasury TIPS and Series EE (PFA-DET-021, PFA-INV-027, PFA-TAX-015)

TIPS use issue/security identity, purchase lot, authoritative dated CPI reference/ratio (with issue-specific lag/interpolation and rounding), original/indexed principal, coupon calendar, maturity floor, wrapper and tax-basis facts. Cash coupon applies to indexed principal; at maturity, eligible redemption honors the original-par floor. Federal taxable inflation/OID may be **noncash** and increases supported basis without increasing bank cash. Missing required CPI observation makes the dependent periods incomplete, never a zero-inflation assumption. Secondary-market purchase, deflation/lot/disposal variants require facts and admitted rules or typed gating.

Series EE uses issue month/vintage, purchase amount, effective issue-specific interest schedule, month/semiannual compounding, any applicable 20-year guarantee, 30-year stop, minimum holding/redemption limits and early-redemption interest forfeiture. Federal interest tax-election timing and state/local exemption follow effective-dated rules and track previously recognized interest to prevent double taxation. Unsupported issue vintage, redemption/education exception or future rule remains incomplete until sourced; do not project a later issue from a current advertised rate as settled law.

### 5.7 B3 — 529 education and Roth transfers (PFA-DET-022, PFA-INV-028, PFA-TAX-015)

A 529 owns dated invested positions (counted once), plan owner, beneficiary, provenance of funded contributions/lots, taxable basis/earnings and expense qualification. Qualified withdrawal must link to a supported adjusted dated expense, with prevention of duplicate expense/tax-benefit use. Nonqualified withdrawals allocate principal/earnings pro-rata and emit separately attributable tax/penalty facts. Ordinary eligible plan-to-plan and beneficiary transfers preserve legal and economic continuity only with plan/law evidence. A state tax claim needs sourced jurisdiction rules; otherwise federal outputs remain separate and state outputs incomplete.

529-to-Roth is a direct trustee transfer to the **beneficiary's** Roth IRA, not a Roth conversion or ordinary contribution. Validate the effective-dated statutory plan-age threshold, recent-contribution/earnings exclusion, beneficiary lifetime cap, current-year recipient IRA compensation/contribution room, and recipient/account match. The D2-A S5 capacity owner supplies aggregate IRA capacity to this operation; D2-B may independently compute eligibility but MUST NOT debit capacity until #149 integrates the shared atomic settlement. Legally unsettled beneficiary-change/plan-transfer account aging is explicitly gated without a sourced interpretation.

### 5.8 C1 — health coverage and premiums (PFA-DET-020, PFA-INS-013)

Coverage is member- and payer-linked with effective start/end, plan/sponsor, elected household members, quoted gross premium frequency, employer share, employee share and exclusive route `pretax_payroll` or `aftertax_bank`. The employee's actual premium cost is recognized once; employer subsidy is not separately spent by the household or included as cash income without its authorized wage/tax characterization. Payroll withholding changes spendable wages and jurisdictional wage bases through shared #101/149 integration. After-tax coverage uses a verified bank source and explicit settlement. Changing job/coverage ends old obligations; overlapping plans require distinct admitted coordination, never accidental double premiums. Do not assume an after-tax premium deduction.

### 5.9 C2 — Medicare, IRMAA and benefit deduction (PFA-DET-020, PFA-INS-013, PFA-TAX-015)

Track each enrolled member's effective Parts A/B/D, elected Advantage or supplemental option, premium liability and payer, and plan/legal eligibility. Exclude mutually incompatible elected configurations (including unvalidated Advantage+Medigap pairing) with a diagnostic. IRMAA is a source-versioned annual tax-year/filing-status/MAGI lookup using its applicable statutory lookback (normally two tax years); approved alternate determinations or life-changing events require their own evidence. Missing MAGI, CMS brackets or future rule may not silently become base-premium-only full-coverage output. Recognize gross Social Security award and full premium once; either net the same premium from benefit payment **or** settle from named bank cash—not both. A Medicare-eligible person need not already be receiving Social Security. #149 owns later SSA↔Medicare shared execution/payroll/settlement reconciliation.

### 5.10 C3 — health FSA plan-year entitlement (PFA-DET-020, PFA-TAX-015)

Health FSA is an employer-plan, person-linked **restricted reimbursement entitlement**, not additional checking cash, securities, or unrestricted net-worth asset. Inputs: elected plan year, payroll deferral/employer additions, effective statutory/plan contribution limit, *uniform coverage* reimbursement availability, eligible dated receipt/expense, named paid-to account, plan-permitted carryover **or** grace period and termination/forfeiture terms. Qualified reimbursements may legitimately precede year-to-date payroll funding up to available elected plan-year coverage; denied/duplicate receipts cannot consume entitlement. Distinguish incurred medical expense, payment and actual reimbursement (not wages); payroll elections decrease pay and supported wage-tax bases once through #101/149. Do not confer a universally available carryover, treat an FSA as an HSA, count conditional entitlement as net worth, or use a current-year limit for another year.

### 5.11 S1–S8 cross-domain freeze: logical contract `d2-shared/v1` (#149 exclusive owner)

The following are **versioned logical interfaces** on merged main; they are binding semantic field/ownership contracts for isolated domain modules, *not* permission for independent branches to invent or edit shared compiled runtime types. Existing canonical/executable interfaces always take precedence. The physical TypeScript adapter and authoritative integration remain solely #149-owned. Each domain module may define private input/output shapes that preserve these fields and convert via #149's adapter; no duplicate scheduler, cash ledger, tax engine or global state writer.

| Seam | Required interoperable data and invariant | Owner / merge boundary |
| --- | --- | --- |
| S1 identities | `personId`, `householdId`, optional `beneficiaryId`/`workerRecordId`/`sponsorId`, `sourceAccountId`/`destinationAccountId`, `instrumentFamily`, `taxBucket`, `effectiveFrom/Through`; legal family and ownership MUST NOT be aliases | #149 canonical adapter; A/B/C consume read-only IDs |
| S2 rules | `ruleSnapshotId`, `jurisdiction`, `taxYear/effectiveDate`, `ruleFamily`, `sourcePublication`, `asOf`, `version`, `projectionStatus` = verified/explicit_projected/unavailable; missing policy stays typed incomplete | #149 controlled rule snapshot; tax/rule author owns law interpretation |
| S3 dated operations | `operationId`, `kind`, `actorId`, `effectiveAt`, `ruleSnapshotId`, `source/destination`, `priority`, `dependsOn`, `grossAmount`, `claimId`; categories distinguish recognition, movement, statutory obligation and settlement | #149 household scheduler; no competing A/B/C graph writer |
| S4 effects/funding | `cashDelta`, `assetDelta`, `liabilityDelta`, `basisDelta`, `restrictedEntitlementDelta`, `recognitionFacts`, `claims`, `taxFacts`, `settlementProposals`, `traceRefs`; proposed operation commits **atomically**, with no unauthorized source or double posting | #149 exact-money ledger/state/funding; domain proposals are pure |
| S5 capacity/basis | `personId`, `taxYear`, `legalLimitScope`, `planId`, `contributionSource`, `usage`, `headroom`, `traditionalIraAggregatedBasis`, `rothVintage`, `beneficiary529LifetimeUsage`, `ruleSnapshotId`; annual reconciliation once; failed operations consume none | #149 interop adapter; #146 A2/A3 domain meaning; #147 B3 consumes versioned A capacity |
| S6 tax characterization | `taxYear`, `jurisdiction`, `incomeCharacter`, `gross`, `taxable`, `basisRecovered`, `withholdingCredit`, `estimatedPayment`, `settlementDue/refund`, `lawVersion`, `completeness`; withholding credit not duplicate tax expense | Tax-engine/#101 owner, integrated by #149; A/B/C no private tax calculator |
| S7 read/diagnostics | `sourceEntityPath`, `period`, `affectedOutput`, `coverage` complete/incomplete/not_applicable, `diagnosticCode`, `missingFacts`, `ruleSnapshotId`, `traceRefs`; no unqualified "complete" forecast when a material supported value is missing | #149 app adapter; U1 #120 owns active shared editors/charts |
| S8 oracles | `caseId`, `domainFamily`, `scenarioVersion`, `ruleSnapshotId`, `openingState`, `authoredFacts`, `expectedEffects`, `expectedCoverage`, `evidenceTier` conditional/isolated_runtime/integrated_runtime/UAT; immutable exact-cent outcomes; existing 55 prep fixtures remain conditional until proven | D2 domain test owner for isolated tests, #149 for joint truth table |

**Parallel authorization and merge order:** (1) this controlled spec/manifest PR merges; (2) #149 holds the logical S1–S8 owner boundary above; (3) isolated, contract-complete D2-A `src/simulation/d2/retirement/**`, D2-C `src/simulation/d2/health/**` and eligible D2-B domain-only helpers may start from fresh merged `main` in separate worktrees, with tests under disjoint `test/d2/**` paths; (4) #149 alone converts these proposals to shared compiler/executor/tax/capacity/read-model authority, serializing shared writes; (5) U1 owns its active files until each interface/path is explicitly released; (6) D2-D acceptance waits for merged audited A/B/C, PFA-TAX-015, applicable shared seams, U1 #120 uncoached UAT and deterministic all-domain truth-table reconciliation. Domain-only CI, including green CI, never changes a conditional fixture into integrated evidence by assertion alone. Future law uncertainty, old #103 RMD scope, the #101 salary tax/payroll seam and #138 isolated advanced tax rules remain retained obligations; no change to R5 gate.
