# Tax Engine Capability

**Version:** 0.4.3-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-TAX

## 1. Purpose

This specification reserves the architecture for a comprehensive tax capability while preserving the existing TaxRule identity/effective-dated rule semantics. It prevents future tax work from becoming a separate inconsistent simulation engine.

## 2. Normative requirements

### PFA-TAX-001 — Deterministic rule execution per realization

Tax calculation SHALL be deterministic for a fixed household state, effective rule set, scenario, and stochastic realization. In probabilistic forecasting, the tax engine SHALL execute inside each realization using the same authoritative recognition/obligation/settlement semantics rather than applying a post-hoc tax percentage to aggregate outcomes.

### PFA-TAX-002 — Effective-dated and jurisdiction-aware rules

Comprehensive tax support SHALL preserve jurisdiction, effective dates, filing/status inputs, rule version identity, and data provenance needed to reproduce a calculation for a given tax period.

### PFA-TAX-003 — Recognition and settlement separation

Taxable recognition, tax liability/obligation creation, withholding/estimated payments, settlement, refund/credit, and account/state effects SHALL remain explicitly distinguishable in accordance with executable financial semantics.

### PFA-TAX-004 — Explainable calculations

Material tax outputs SHALL carry calculation lineage sufficient to identify taxable bases, applied rule versions, major deductions/credits/limits, and the financial events that produced the tax result.

### PFA-TAX-005 — Performance instrumentation

Tax execution SHALL participate in PFA-PERF phase timing and benchmark fixtures so stochastic scaling can distinguish tax cost from other engine cost.

### PFA-TAX-006 — Law uncertainty is explicit

Future tax-law uncertainty SHALL be modeled only through explicit scenarios/stochastic policy processes with provenance. The deterministic tax engine SHALL NOT silently guess future law changes.

**Approved projected-law scenario distinction (2026-10-19):** A calculation that has executed all materially applicable supported financial/tax rules for the entire requested period MAY be `completed` *under an explicitly selected, persisted, reproducible projected-current-law scenario*. A projected rule is not enacted law: every affected output SHALL retain machine-readable projected-law qualification including jurisdiction, base rule/version/year, effective period, scenario assumption and catalog fingerprint. Forecast computation completeness and future-law certainty are different dimensions. A scenario lacking explicit future-law assumption consent, a resolvable rule, or required tax mechanics SHALL remain `incomplete` for affected outputs; do not silently treat missing tax as zero or default all real households into a projected-law completion claim.

### PFA-TAX-007 — Equity compensation integration

Supported RSU/options/ESPP mechanics SHALL integrate vesting/exercise/sale recognition and withholding with the tax engine according to PFA-EQ and SHALL NOT use an unrelated shortcut calculation.

### PFA-TAX-008 — Output-level tax completeness

Missing tax capability SHALL gate outputs at the smallest materially affected boundary. A derived metric/result that can be materially changed by unsupported tax recognition, liability, withholding, settlement, or tax-driven funding behavior SHALL NOT be presented as a complete household forecast. The result SHALL be blocked or explicitly scoped as incomplete with machine-readable missing-capability diagnostics.

Outputs whose dependency/lineage is demonstrably unaffected by the missing tax capability MAY remain available. The application SHALL NOT globally suppress tax-independent outputs merely because another household output is tax-affected.

**Output completeness under hypothetical law (2026-10-19):** Merely warning that an *explicitly selected and executable* projected-current-law rule is hypothetical SHALL NOT, by itself, mark an otherwise fully calculated output incomplete. Preserve the warning as a separate, machine-readable law-confidence qualification. Any other materially missing/unsupported jurisdiction, filing status, tax base, recognition, withholding/settlement, payroll, or execution mechanic SHALL independently keep affected outputs incomplete. When both types occur, incompleteness wins; verified tax-independent outputs may remain complete. This rule applies per period/output and to the aggregated run, not via a UI-only status override.

### PFA-TAX-009 — Target-cohort tax floor

Before a probabilistic result is exposed as a complete user-facing household forecast, the implemented tax subset SHALL cover the tax semantics materially relevant to that target household and output. The application MAY develop/test stochastic infrastructure against a narrower synthetic tax subset, but production/alpha results SHALL remain capability-gated until the applicable tax floor is satisfied.

**Result meaning:** `completed` means the *selected scenario* actually finished the requested modeling period with no missing materially applicable capability; it never means future tax legislation is verified, returns are guaranteed, or every possible household tax type is implemented. Explicit scenario selection and exact reproducible law basis are prerequisites to any projected-law-qualified `completed` status. Unsupported salary withholding, payroll, benefit or retirement distribution behavior still obeys the target household/output tax floor and SHALL NOT be laundered into completeness through this change.

### PFA-TAX-010 — Private-alpha core tax coverage

The private-alpha tax floor SHALL target ordinary salaried/investor households rather than exhaustive tax-law coverage. For an alpha household/output, the supported floor SHALL include every materially applicable item from the following set:

- federal ordinary income tax with filing status and progressive brackets;
- the standard deduction and basic deduction mechanics required by the target household;
- employee payroll taxes, including Social Security and Medicare where applicable;
- state income tax for jurisdictions represented by the alpha cohort;
- local income tax where materially applicable to an alpha household;
- taxable interest and ordinary dividends;
- qualified-dividend treatment where modeled;
- short-term and long-term capital gains for modeled realized sales/liquidations;
- basic traditional retirement-account contribution/withdrawal tax treatment;
- basic Roth contribution/withdrawal tax treatment;
- NIIT where the target household/output can materially encounter it;
- withholding/estimated-payment/settlement behavior sufficient for the supported after-tax cash-flow outputs; and
- RMD or other retirement-distribution tax mechanics when the person's age/horizon makes them material to the output.

Property tax MAY remain an explicit household expense when no tax-rule interaction is needed. Sales tax MAY remain embedded in spending assumptions unless separately modeled.

Self-employment/business taxation, AMT, complex credits/phaseouts, rental/pass-through taxation, foreign tax, estate/gift tax, and equity-compensation-specific taxation MAY remain T1B capability-gated unless an intended alpha household requires them. If such a household is admitted, the applicable mechanic becomes part of that household's required tax floor before affected outputs are presented as complete.

### PFA-TAX-011 — Shared versioned tax-rule catalog

Canonical TaxRule remains the semantic shape for an effective-dated tax rule, but common tax-law definitions SHALL be stored as a reusable versioned rule catalog rather than duplicated into each household. The catalog SHALL support immutable rule/version/content identities, jurisdiction/effective dates, provenance/source metadata, and deterministic content fingerprints sufficient to reproduce a forecast basis.

During the personal/local stage, the rule catalog MAY be version-controlled application data shipped with the app. Before/within private-alpha shared persistence, common rule definitions SHOULD be stored once per effective rule version/content fingerprint in shared persistence. Household/scenario data SHALL store the facts, elections, overrides, and rule references needed to resolve applicable rules, not full duplicate copies of common law data.

Executable algorithms belong in the rules engine and SHALL remain separate from the versioned rule data they evaluate. Forecast results and Forecast Basis metadata SHALL reference the exact resolved tax-rule-set fingerprints used.

Portable export/import SHALL preserve enough rule identity/fingerprint information to detect whether the referenced rule set is available and compatible. Whether exports embed a referenced rule bundle or rely on a resolvable catalog is a later transport/persistence decision; silent substitution with a newer rule set is forbidden.

### PFA-TAX-012 — Tax-sensitive planning decisions

Supported tax-sensitive decisions such as contribution type, withdrawal ordering, conversions, realized gains/losses, or other elections SHALL enter the tax engine as explicit supported decisions/events/policies rather than as optimizer-owned tax arithmetic. Their tax consequences SHALL retain the same rule identity, effective dates, lineage, and completeness diagnostics as ordinary forecast calculations.

### PFA-TAX-013 — Authoritative finalist tax evaluation

A planning/search layer MAY use explicitly labeled lower-fidelity tax estimates for candidate screening only when a specification permits it. Any user-facing finalist strategy whose conclusion materially depends on tax SHALL be reevaluated through the authoritative tax engine at the required tax-completeness level before being presented as an integrated planning result.

### PFA-TAX-014 — Private-alpha deterministic investment/retirement tax characterization

Before stochastic household modeling, the deterministic tax path SHALL support or explicitly capability-gate the tax characterization materially required by PFA-DET for the intended private-alpha households.

The supported floor includes, where applicable:

- short-term and long-term realized capital gains/losses;
- taxable interest, including supported checking/savings, Treasury/bond, and CD interest;
- ordinary/non-qualified dividends and qualified dividends;
- traditional and Roth 401(k)/IRA contribution and distribution treatment, including whether the contribution changes the applicable income-tax and/or payroll-tax base;
- after-tax 401(k) contribution basis and supported in-plan Roth conversion treatment, preserving previously taxed basis and recognizing taxable conversion amounts only under the applicable rule;
- HSA payroll contribution/distribution treatment required by the target jurisdiction/output, including jurisdiction-specific nonconformity where material;
- employer 401(k) matching/non-elective and employer HSA contribution treatment, including their interaction with applicable combined contribution limits;
- effective-dated 401(k), HSA, and IRA contribution/catch-up limits required by supported D1 flows, distinguishing employee elective-deferral limits from combined employer+employee limits where applicable;
- supported direct and indirect retirement rollover tax treatment, including preservation of pre-tax/Roth/after-tax basis/character and applicable withholding/deadline/frequency restrictions;
- taxable-brokerage purchases/sales and basis realization;
- cryptocurrency dispositions;
- supported option sale/exercise/assignment/expiration tax facts; and
- dividend reinvestment without loss of the underlying dividend tax recognition.

Where federal/state/local treatment differs, target-cohort jurisdiction rules SHALL resolve the applicable behavior or the affected after-tax output SHALL remain incomplete. Missing rules SHALL never be interpreted as zero tax.

### PFA-TAX-015 — D2 pre-stochastic retirement/benefit/account tax characterization

Before R5 stochastic household runtime begins, the deterministic tax path SHALL support or explicitly capability-gate the materially applicable tax characterization for the D2 common-household breadth floor.

The supported floor includes, where applicable:

- Social Security retirement/spousal/survivor benefit taxation;
- defined-benefit pension income/distribution taxation;
- 403(b), governmental 457(b), TSP, SEP IRA, and SIMPLE IRA contribution/distribution/rollover tax character;
- Traditional IRA to Roth IRA conversion;
- nondeductible IRA basis, aggregate IRA pro-rata treatment, and supported backdoor Roth conversion;
- after-tax workplace contribution basis and supported mega-backdoor in-plan conversion or Roth rollover;
- health FSA contribution/reimbursement tax treatment;
- TIPS taxable coupon/inflation-accretion characterization;
- Series EE savings-bond redemption/interest characterization for the supported path;
- 529 contribution/distribution/rollover tax facts, including qualified versus non-qualified distributions and supported 529-to-Roth-IRA rollovers; and
- income facts required for supported Medicare income-related premium adjustments.

Missing material rules SHALL block only affected after-tax outputs, but R5 SHALL NOT start while an item required by the admitted D2 deterministic household contract lacks a defined supported or explicitly gated tax path.

**D2-A/B/C PM approval cross-reference (2026-10-17):** PFA-TAX-015 SHALL use the detailed A1–C3 and S6 contract in PFA-DET §5 (`d2-shared/v1`) as the approved input/traceability boundary, while **PFA-TAX alone** owns law interpretation and authoritative tax liability/withholding/settlement. In particular: Social Security provisional-income treatment is not a blanket 85% inclusion; pension employee basis is tracked; per-person Traditional/SEP/SIMPLE IRA pro-rata basis is reconciled using applicable tax-year December-31 facts; conversion/rollover/regular-contribution/RMD characters remain distinct; eligible mega after-tax basis is not taxed twice; TIPS noncash accretion and Series EE vintage/election treatment cannot be assumed cash; 529 qualification and beneficiary Roth transfer are conditioned on sourced law/annual capacity; FSA and health premium pretax wage effects are not duplicated; Medicare IRMAA consumes sourced historical tax facts. Future rule values and missing material inputs yield output-level incompleteness, never a fabricated complete net-cash projection. This cross-reference authorizes no new T1B code or duplicate tax engine and preserves the independent #101 payroll withholding owner.

### PFA-TAX-016 — Private-alpha capital-loss, wash-sale, tax-loss-harvesting, and 1031 floor

Before private alpha, the authoritative tax engine and planning boundary SHALL support the following deterministic tax mechanics when the household uses the affected asset class:

- **wash-sale rules:** detect supported substantially-identical replacement acquisitions within the applicable pre/post sale window across represented household accounts, disallow the applicable loss, and carry the required basis/holding-period adjustment or other legally required treatment; unobserved external-account activity SHALL produce a limitation diagnostic rather than a false clean result;
- **capital-loss netting and carryforward:** preserve short-term versus long-term character, apply the supported annual netting/ordinary-income deduction limit, and carry unused losses forward with reproducible tax-year lineage;
- **tax-loss harvesting:** allow an explicit user/planner-proposed harvesting transaction/strategy, evaluate it through authoritative lot/basis, wash-sale, loss-netting/carryforward, transaction-cost, and tax-completeness semantics, and avoid presenting a harvested tax benefit as guaranteed when future offsetting gains/income are uncertain or unsupported; and
- **Section 1031 like-kind exchange:** support a bounded real-property exchange contract with relinquished/replacement property identity, qualifying-use/like-kind checks, timing requirements, carryover basis, boot/liability effects where supported, and recognized/deferred gain. Unsupported multi-property, partnership-interest, reverse/improvement, or other specialized exchange structures SHALL be capability-gated.

These mechanics are a mandatory private-alpha tax floor even though other T1B domains may remain capability-gated by cohort. Tax-loss harvesting logic SHALL consume PFA-TAX results; portfolio/planning code SHALL NOT duplicate wash-sale, basis, carryforward, or 1031 tax formulas.

### PFA-TAX-017 — Optimization-ready tax-rule composition

Supported tax rules SHALL be available through a stable tax-domain contract that can determine, as applicable, rule applicability, dependencies, elections, limits/constraints, jurisdiction/effective-date composition, and resulting tax state transitions for a proposed household strategy.

Federal, state, local, and other supported jurisdiction rules SHALL compose through authoritative tax-rule resolution rather than optimizer-owned arithmetic. Missing material cross-rule or cross-jurisdiction interactions SHALL produce capability diagnostics rather than being treated as zero or silently ignored.

This requirement does not require every tax rule to be encoded as a closed-form numeric expression or solver-native constraint. The authoritative evaluator MAY remain procedural, graph-based, or otherwise implementation-neutral so long as planning/search can evaluate proposed strategies reproducibly through the same tax semantics.

### PFA-TAX-018 — Multi-period tax state and explicit legal predicates

Supported tax facts that can affect later periods SHALL remain explicit, reproducible state across the planning horizon. This includes, where applicable, basis and tax lots, holding periods, loss/credit/deduction carryforwards, depreciation/amortization state, previously taxed amounts, contribution/distribution/conversion history, elections, and other effective tax attributes.

When a tax consequence depends on a legal, factual, or facts-and-circumstances predicate that the authoritative household data and supported rules cannot resolve deterministically, that predicate SHALL remain explicit as an input, assumption, scenario branch, or capability diagnostic. The optimizer SHALL NOT silently guess the legal conclusion merely to complete a search.


### PFA-TAX-016 — approved initial isolated implementation boundary (PM decision, 2026-10-17)

**Product-manager decision approved 2026-10-17: use the narrow land-only Section 1031 subset for the initial implementation.** This controlled specification becomes the merged implementation authority only after PR #140 passes verification and is merged. This boundary authorizes only a reusable *pure federal rule layer*, not household or portfolio integration, settlement, or a declaration that the private-alpha PFA-TAX-016 floor is complete. Follow-on integration under separately approved shared-authority ownership remains mandatory before R11.

- **Invariant:** Provenance/effective tax year, jurisdiction, filing status, rule-set fingerprint, deterministic exact Money/quantities, immutable opening/closing state, input/lot/property identities, traceability, explicit legal predicates, source dates and explicit rounding. Unknown facts (including external accounts) are incomplete, not false or zero. No proprietary forecast tax formulas duplicated in planning/UI and no silent state/local equivalence.
- **Wash-sale:** Supported federal stock/security losses; inclusive 30-day pre/post window, sold versus replacement accounts/owners/lots and explicit substantially-identical legal predicate. Match acquisition quantities once only; support partial/overlapping replacements and proportional disallowance, ordinary taxable replacement lot basis increases and holding-period tacking. IRA/Roth IRA matched replacement loss is disallowed **without** creating increased IRA basis (IRS Rev. Rul. 2008-5). Covered spouse/controlled-entity and options/rights depend on explicit supported facts; dealer/complex derivatives/unknown external activity are capability-gated.
- **Annual capital-loss and carryover:** Separate opening/realized short- and long-term character, intra-character then cross-character netting, $3,000/$1,500 MFS annual ordinary deduction under effective-dated reviewed law, *taxable-income* limits and official Schedule D capital-loss carryover worksheet ordering (short-term loss used first). Persist character and tax-year/result lineage across years, including reduced/zero taxable income; do not treat the current tax calculator's scalar `unusedCapitalLoss` as multi-year character-preserving carryover. Unsupported capital-gain subclasses, NOL interactions, changing filing ownership and missing return context explicitly gate affected results.
- **Tax-loss harvesting:** Compare explicit user/planner-proposed lots and replacements using actual lot/basis, matching wash-sale outcome, expenses and paired authoritative *completed and comparable* PFA-TAX evaluation results; preserve tax years, jurisdictions, fingerprints, timeline and provenance. A current-year tax delta is computed only from comparable authoritative outputs. Never infer marginal tax rates, predict guaranteed future savings, ignore uncertainty around offsetting gain or promote an unrecognized paper loss into a realized benefit.
- **Section 1031 — approved initial private-alpha subset:** Initial bounded federal case is **one U.S. non-depreciable investment land parcel for one qualifying U.S. replacement land parcel** through a deferred qualified-intermediary exchange, with evidenced identity/ownership/held-for-investment/like-kind/qualified-intermediary/no constructive-receipt facts. Require replacement identification within 45 calendar days and receipt within the earlier of 180 days or documented federal-return due date including evidenced extensions; no guessed extension. Calculate realized, recognized (boot-limited) and deferred gain, no recognized loss on qualifying property, with exact replacement basis reconciliation including allowed cash/non-like boot, liabilities assumed/relieved and eligible costs. Unknown debt/expense interactions, prior depreciation/recapture, rentals, related-party two-year follow-up, multiple properties, reverse/improvement exchanges, partnership interests, foreign property, principal residences and other special structures remain explicitly unsupported. **Scope decision:** the product manager approved the land-only subset on 2026-10-17; depreciable-property mechanics are explicitly deferred and are not authorization to broaden Issue #138.
- **Deferred Section 1031 enhancement — depreciable and complex real property (future T1B, not Issue #138 or the initial R11 floor):** Preserve a later capability track for qualifying investment rental/commercial buildings and improvements, mixed land/building/component allocations, historical adjusted basis and depreciation *allowed or allowable*, cost segregation, Section 1245/1250 recapture and unrecaptured Section 1250 gain characterization (where applicable), Form 8824/Form 4797/Schedule D reporting interactions, replacement-property carryover basis and continuing depreciation schedules, boot/debt/eligible-cost allocation, and state/local divergence. Separately evaluate related-party exchanges with post-exchange holding requirements, reverse/improvement and multi-property exchanges only under their own resolved contracts. These cases may be legally valid Section 1031 exchanges, but must be reported as **unsupported/incomplete** under the initial land-only capability, never automatically ineligible or fully tax-deferred. Do not force the entire cohort's tax-independent outputs to be blocked. Before later implementation, the product manager must approve the precise admitted asset classes and factual/legal predicates, dedicated source of depreciation history, effective-dated treatment and authoritative tax-recognition/integration owner; create/register a consolidated follow-on implementation task then, not four advance micro-issues. If a private-alpha household requires these cases to produce a complete tax-affected result, the affected result remains gated until the necessary extension is implemented and audited. Sources: [IRS Form 8824 instructions](https://www.irs.gov/instructions/i8824) and [IRS Publication 544](https://www.irs.gov/publications/p544).
- **Execution ownership:** [Issue #138](https://github.com/bensmullen/personal-finance-app/issues/138) contains the consolidated gated PFM_TASK_V3 authorization, limited to `src/rules/tax/t1b/**` plus two named standalone tests/fixtures. It is intentionally **closed** pending PR #140 verification/merge; the scope choice is approved but Codex may not start until the merged prerequisite and issue activation gates are satisfied. It MUST NOT write current calculator/contracts/exports/catalog, compiler, simulation/tax participant, planning, UI, canonical schemas or common settlement. A later authorized tax integration owner must connect these pure outputs to true household lot/property events and authoritative taxable recognition, tax-year state and resulting user strategy actions; all four domains remain mandatory before private-alpha R11.

## 3. Planned decomposition

Later tax specifications may be split by federal, state/local, payroll, investment/capital-gains, retirement, equity-compensation, and estate/gift domains when actual implementation breadth justifies that decomposition.

## 4. Output availability during incomplete tax coverage

Generally tax-independent outputs can include observed current balances/current net worth, contractual debt schedules, gross income/expense schedules, and explicitly pre-tax quantities when no downstream tax-dependent funding/state transition feeds back into them.

Generally tax-affected outputs include after-tax/disposable cash flow, forecast cash/liquidity, savings capacity, liquidation proceeds, retirement-withdrawal outcomes, realized taxable investment outcomes, RSU/equity-compensation outcomes, tax-sensitive scenario comparisons, and any future net-worth/goal/liquidity probability whose path depends materially on those taxes.

These are examples, not a hard-coded list. Runtime output validity SHOULD be driven by dependency/lineage and capability diagnostics so the system blocks only what is actually affected.

## 5. Sequencing

Comprehensive tax implementation need not precede every later product capability, but R5 SHALL NOT begin until the D2 tax characterization required by PFA-TAX-015 is complete for the admitted deterministic breadth floor. T1A SHALL implement PFA-TAX-010 for the actual private-alpha cohort and PFA-TAX-011's reusable catalog boundary. T1B remains the advanced/specialized track, but its PFA-TAX-016 capital-loss/wash-sale/tax-loss-harvesting/1031 slice is a mandatory private-alpha gate; other specialized business, AMT, complex credit/phaseout, rental/pass-through, foreign, estate/gift, and equity-compensation domains gate only the outputs that depend on them unless the alpha cohort requires them.

PFA-TAX-017 and PFA-TAX-018 reserve the architecture needed for future comprehensive tax optimization; they do not make exhaustive federal/state/local tax-law coverage a private-alpha prerequisite. New tax domains SHOULD preserve these rule-composition and multi-period-state seams as they are added.

Tax performance must be measured before high-realization-count production forecasts rely on it.
