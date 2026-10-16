# Eight-household user-journey discovery — initial product hypotheses

**Status:** non-normative UX discovery draft; requires product-manager review before becoming an implementation design. **Date:** 2026-10-16. **Sources:** [eight household blueprints](household-blueprints.md), [Issue #108](https://github.com/bensmullen/personal-finance-app/issues/108), PFA-UX-015–023. This document defines *user outcomes*, not UI pages, navigation, financial formulas, capability claims, or executable fixtures.

## Intended learning progression

A first-time user should reach a useful, honestly bounded insight before needing to enter their whole financial life. The eight synthetic personas are contrasting discovery lenses, **not** validated market segments or a substitute for direct user research.

1. **Explore without commitment:** select a synthetic household or start a personal model. State what this example represents, its major unknowns, and a small number of relevant questions. Never imply that a demo is the user's private model.
2. **Understand today's position:** establish household/member boundaries and surface financial position, income, spending, cash, debts, investment concentration and immediate risks as supported. Teach the distinction between account value, cash flow, debt paydown, transfers and income only when relevant.
3. **Establish data trust and forecast readiness:** distinguish known facts, inferred/derived results, user assumptions, conflicts, missing authority and unsupported capabilities. For own data, guide connection/import or minimal manual entry; let users fix the originating fact once, in context. Do not force all facts before a bounded first insight.
4. **Understand the future baseline:** explain what stays the same and what changes (employment, children, housing, retirement, healthcare, known benefit dates, debt maturity). Show forecast assumptions, uncertainty/unsupported boundaries and notable cash/solvency pressure points; don't portray deterministic output as guaranteed truth.
5. **Compare meaningful choices:** offer separately saved, genuinely independent plans when Issue #105 functionality exists. Explain what decisions changed, which basis is comparable and the practical tradeoffs; don't pretend an unsupported tax, estate, disability-benefit or multi-state calculation is complete.
6. **Choose actions and revisit:** capture prioritized next questions/decisions and their expected effect, preserve input provenance, let users return to a baseline, and explain which new data or life event should prompt a fresh review. No product investment recommendation without supported decision rules.

**Entry modes:** a zero-entry, resettable synthetic demonstration for discovery; an optional personal onboarding path using supported direct read-only connection/review where available, otherwise proportionate manual authoring or narrow import. A synthetic persona's four example plans are fixture acceptance targets, not proof that comparison UI presently exists.

## Persona needs — questions before page design

| Persona | What the user likely knows on entry | What they need to learn, in order | Most valuable supported insight / decision |
| --- | --- | --- | --- |
| **H01 Vale — multigenerational wealthy retirees** | Properties, accounts, family relationships, high-level legacy intentions; not consolidated cross-family economics | Individual ownership and household boundaries → retirement/cash needs → gift/estate scenarios → limitations of legal/tax projections | How gifting, property and survivor choices affect *each economic owner*; never quietly pool adult descendants' assets or claim verified estate outcomes |
| **H02 Torres — liquidity-stressed multigenerational family** | Monthly bills, four mortgages, variable rental performance, high-cost debt, pension, household dependents | Available cash vs gross property wealth → debt service and rentals → stress scenarios → education/retirement tradeoffs | Whether retaining or selling rentals materially changes near-term cash pressure; preserve grandparent and children's distinct property |
| **H03 Chen — Bay Area dual-tech earners** | Salary, RSU grants/vests, mortgage, savings and current childfree life | Actual liquid wealth vs employer-stock concentration → obligations/forecast → childcare/leave effect → compare zero vs two future children | How a family decision or employer-stock diversification changes financial resilience and long-term options; no invented RSU tax completeness |
| **H04 Barlow — midcareer noninvestor** | Pay, mortgage, debt and lifestyle spending; little understanding of market accounts | Monthly surplus and reserves → debt cost/employer match basics → first contribution → baseline vs debt/spending/investing choices | Which feasible first steps improve resilience without assuming money is available to invest |
| **H05 Delgado — 18-year-old apprentice** | Paycheck, union benefits, tools and transportation bills, living at home | Gross pay vs take-home/benefits → true monthly spend and cash buffers → workplace/IRA options → moving-out affordability | What rent, car/tools and savings contributions mean for independence timing |
| **H06 Bennett — young NYC consultant** | Salary/bonus, rent, student debt and investment balances | After-tax/expense budget with known withholding limits → student-debt choices → housing/career changes → geographic/MBA scenarios | Cash flexibility gained by lifestyle, relocation or repayment alternatives, with explicit NYC tax-rule completeness |
| **H07 Price — mobile remote engineer** | Remote salary, brokerage/retirement, van loan and travel spending; mailing address | Cash runway and van replacement → work/travel timeline → tax residency facts vs mailing address → mobility vs home purchase | Whether mobile life remains sustainable under realistic location, replacement and sabbatical choices, without guessed tax domicile |
| **H08 Ortega — Denver near-retirement with adult dependent** | Account balances, $5m opening household net worth, pension/retirement timing and dependent's care commitments | Investable/cash vs home value → lifelong household care spending → health insurance/Medicare transition → retire 62 vs 67 and survivor scenarios | Retirement affordability and care-support tradeoffs, with unsupported special-needs trust/benefit eligibility clearly separated |

These are **hypotheses about likely user knowledge**, not claims about the fictional people's actual behavior. Validate them in later novice interviews/uncoached journey tests.

## Journey acceptance questions (not screen designs)

For each persona:
- Can an uncoached person explain whose money is represented, what is known versus assumed, and the first useful takeaway?
- Can they identify the single financial decision worth exploring next without studying canonical model vocabulary?
- Can they compare baseline versus a materially different plan without confusing saved choices, saved forecast results and unsupported claims?
- Can they trace a questionable number to its single source, understand whether it is editable, and recover from an incomplete/invalid setup?
- Can they say what data or life event would change the interpretation, without being forced through unnecessary forms?

**Level 3 follow-on:** [audited use cases, exception handling and activity flows](user-journey-level3.md) now map all six stages (33 interaction contracts). This is a non-normative design proposal; after PM review, select 2–3 pilot personas (H04 novice investor, H02 cash-stressed family, H08 retirement/care or H03 family planning) for visual flows and interactive prototypes. Do not implement those flows until UX evidence and design approval exist.

## Parallel development boundaries

This research can proceed alongside UX framework PRs, isolated D2 fixtures/helpers and backend tax/semantics work. It owns only `docs/alpha/**` and must not modify shared authoring UI, canonical financial data, normative spec registry or U1B Issue #120. U1B visual implementation and D2 runtime integration remain separately gated by their approved contracts; later issue/roadmap updates must reconcile dependencies and stable shared interfaces.
