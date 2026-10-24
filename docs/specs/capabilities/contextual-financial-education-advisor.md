# Contextual Financial Education Advisor

**Version:** 0.2.0-draft
**Status:** Proposed future capability; no alpha launch obligation
**Requirement prefix:** PFA-ADV

## 1. Purpose and product boundary

Define an optional, contextual AI guide that helps people understand their household finances, application terminology, and supported forecasts **and construct user-directed alternative financial plans** so they can make their **own** decisions. The guide educates, elicits inputs and supports what-if exploration; it is not a discretionary financial planner, broker, portfolio recommender, or autonomous decision-maker.

The first supported phase may be **read-only and non-advisory**: explain what a figure means; show its provenance, assumptions, uncertainty, and limitations; translate labels; and guide users through existing forecasts. The approved **future advisor capability** also includes conversation-driven creation and revision of alternate *draft* financial plans, authoritative simulations, and explanations of resulting tradeoffs, with user approval before durable plan creation or edits. Supporting user-initiated hypotheticals is distinct from the agent recommending a decision.

Conversation-driven alternate-plan drafting and simulation are **approved product requirements for a future phase**, not implementation authorizations or private-alpha requirements. The tool orchestration architecture, eligible model/provider integrations, and external MCP adapter remain deferred design choices; any actual implementation must be separately specified, scoped, privacy-reviewed, and approved. A user-visible product name such as "Financial Guide" is preferable to implying a regulated adviser relationship.

## 2. Normative requirements

### PFA-ADV-001 — Education-only initial scope
The guide SHALL teach, interpret, and support user-initiated hypothetical plan construction; SHALL NOT give personalized investment advice, choose or recommend securities, positions, trades, allocations, or transaction timing; SHALL NOT claim fiduciary/professional status; and SHALL NOT present a financial action as the user's required or best decision. It MAY explain general financial concepts, observed account characteristics, portfolio terminology, *already-modeled or newly user-requested hypothetical* tradeoffs without prescribing actions. It SHALL NOT convert a user question into an unrequested prescriptive strategy search. Expanded recommendations require an explicit product/regulatory decision and new governed requirements.

### PFA-ADV-002 — Contextual rather than chat-first assistance
The default entry points SHALL be embedded in the relevant household summary, forecast visualization, metric, financial field, plan/scenario, and diagnostic where supported. Contextual help SHALL inherit an authorized, stable **reference** to the active view, selected plan, metric, run, and Forecast Basis rather than asking the user to restate them. A conversation panel MAY supplement the experience, but SHALL NOT be the primary navigation or comprehension prerequisite. Context switches SHALL be visible to the user.

### PFA-ADV-003 — Financial literacy adaptation without judgment
The guide SHALL express concepts in clear, respectful language appropriate to a user-selected or user-confirmed familiarity level; offer progressively deeper calculation/rule explanations; define unfamiliar terms in context; and avoid implying that inferred literacy or appetite is a financial fact or suitability determination. Users SHALL be able to ask for simpler or more technical explanations without changing canonical financial assumptions.

### PFA-ADV-004 — Grounding and financial authority
Material numerical statements about a household or forecast SHALL be grounded in authorized authoritative read models or source-backed engine results. The guide SHALL identify whether a number is historical/current, an assumption, deterministic projection, probabilistic result, or missing/unsupported; SHALL retain meaningful period, units, model/run provenance, and freshness; and SHALL NOT invent missing financial data or maintain competing tax, investment, or cash-flow calculations.

### PFA-ADV-005 — Limitations and uncertainty remain visible
Explanations SHALL preserve unsupported/partial domains, missing data, stale results, forecast assumptions, non-comparable Forecast Bases, and uncertainty. The guide SHALL distinguish a simplified educational explanation from a complete financial conclusion; SHALL NOT turn a forecast into a guarantee; and SHALL direct the user to relevant assumptions or source details when a conclusion materially depends on them.

### PFA-ADV-006 — Read-only default and action separation
Initial *read-only phase* privileges SHALL be limited to authorized contextual reads and explanatory navigation. The separately approved future alternate-plan capability MAY prepare an isolated proposal and request budgeted simulation through typed app operations but SHALL require explicit user review and confirmation before durable plan creation or changes. Editing/deleting existing plans or initiating external financial actions requires separate authorization and safeguards, and no external transaction execution is approved. Model text SHALL NOT be an executable command or implicit approval; this requirement does not authorize implementation ahead of its milestone gate.

### PFA-ADV-007 — User-owned Markdown interaction profile
The design SHALL provide for a per-user, human-readable Markdown interaction profile based on [the template](../../advisor/user-interaction-memory.template.md). Its scope is conversational preferences: self-described financial literacy, preferred explanation depth, learning goals, financial topics important to the user, desired tone, and optionally **qualitative** comfort with investment volatility/uncertainty. Investment comfort SHALL only tune educational framing, never drive suitability scores, product selection, risk allocation, or recommendations.

### PFA-ADV-008 — Profile consent, accuracy, and controls
When implemented, the profile SHALL be opt-in to persistence, reviewable, editable, exportable, and deletable; each saved item SHALL be attributable to explicit user input/confirmation with an update timestamp. Auto-summarized hypotheses MAY be displayed for confirmation but SHALL NOT silently become durable attributes. The agent SHALL not assert certainty about a person's literacy, priorities, risk tolerance, or life situation based on chat inference. A user request to avoid or remove a preference SHALL be honored in product behavior, subject to the implemented deletion policy.

### PFA-ADV-009 — Separate preferences from financial facts
The Markdown profile SHALL NOT become an authoritative household ledger, portfolio inventory, tax record, account balance store, transcript archive, or credential store. Exact financial facts belong to the canonical household/data provenance system; goals, assumptions and decisions belong to their existing planning boundaries. The profile SHALL carry no credentials, account identifiers, security tokens, or raw financial statements. User-entered profile text SHALL be treated as untrusted data, not a privileged instruction source.

### PFA-ADV-010 — Privacy, household isolation, and retention
Any durable interaction profile or LLM context SHALL be isolated to its authorized user/household and secured under the approved privacy, identity, storage, export, deletion, and retention controls. Only minimum necessary view excerpts and approved profile fields MAY be sent to an external model; raw financial values and text MUST NOT be placed in telemetry or logs merely to support the guide. No real private-alpha data MAY be sent to a third-party AI provider until the applicable provider, consent, and personal-data review is complete. No real user profiles shall be committed to source control.

### PFA-ADV-011 — Model/provider and billing neutrality
The design SHALL distinguish the app's own account identity, ChatGPT identity sign-in, delegated ChatGPT-plan usage where participating-app eligibility permits, and separately billed API usage. A ChatGPT subscription SHALL NOT be assumed to include ordinary API calls. A provider choice SHALL NOT change financial semantics or source-of-truth permissions. Users SHALL see the applicable usage/price limits before any paid or quota-consuming path is enabled; the app SHALL never request the user's ChatGPT password or session cookie.

### PFA-ADV-012 — Bounded orchestration and optional MCP
Typed, permission-controlled tool invocation is required to safely execute the approved future alternate-plan workflow, but its concrete orchestration layer design remains a deferred architecture evaluation; an external MCP adapter is independently optional. The first education-only read surface needs neither. Any implementation SHALL reuse the same authoritative plan authoring, read-model, scenario validation, and simulation boundaries as the application; neither an LLM nor an MCP tool SHALL directly write canonical state. Tool outputs, user conversation, and stored memory are untrusted data, not privileged control instructions. Provider-specific schemas SHALL be adapters, not domain financial authority.

### PFA-ADV-013 — Resilience, accessibility, and transparent AI status
Contextual explanations SHALL be clearly identified as AI-generated, be accessible via keyboard/screen reader/touch, and degrade to ordinary application context/help when a provider is unavailable, a user declines AI, or a budget is exhausted. The app SHALL NOT conceal underlying source details or block ordinary financial workflows on an AI failure.

### PFA-ADV-014 — Explicit verification and adoption gates
Before any feature is enabled for real users, independently verify reference/Forecast-Basis grounding, unsupported/stale explanations, cross-household denial, profile consent/edit/delete controls, prompt-injection isolation, cost ceilings, and education-versus-advice boundaries with synthetic fixtures and focused user-comprehension evaluation. Before enabling alternate-plan drafting, additionally verify baseline immutability, rejected/ambiguous inputs, user approval boundaries, plan identity and lifecycle, source-grounded comparisons, and unsupported-domain blocking. No version of this capability is a mandatory R11/private-alpha exit requirement absent a later explicit product-owner roadmap decision.

### PFA-ADV-015 — Conversation-driven alternate-plan drafts
When the future plan-authoring phase is enabled, the guide SHALL translate **user-initiated** "what if" questions and iterative conversational choices into typed *candidate* planning inputs, not directly into authoritative facts or silently saved plans. It SHALL support creating one or more named alternative drafts from the currently selected plan, preserving the existing plan/scenario identity and ownership semantics established in P1 and [Issue #105](https://github.com/bensmullen/personal-finance-app/issues/105). No new competing canonical Goal/Plan/Scenario model is implied.

### PFA-ADV-016 — Input elicitation and assumption provenance
The guide SHALL identify the minimum inputs needed for the user's particular supported hypothetical and ask focused questions about material unknowns before making definitive projections. It SHALL distinguish confirmed household facts, user-stated hypotheticals, future assumptions, editable *illustrative* defaults, derived values, and unresolved inputs; label the source, approximation and units/time basis of each. It MAY offer existing PFA-UX user-editable planning presets as transparent options, but SHALL NOT invent balances, eligibility, tax facts, preferences, or other missing material inputs. Missing high-impact inputs SHALL prompt clarification, a visibly bounded conditional illustration, or a fail-closed unsupported/incomplete result—never silent fabricated precision.

### PFA-ADV-017 — Independent drafts, review, and explicit save approval
A conversation-derived alternate plan SHALL be isolated from the source plan during drafting and testing. Before any durable create/update, the UI SHALL show a concise review of the source plan, proposed plan name, changed decisions, retained facts, added assumptions, unresolved limitations, and expected effects on modeled scope. Explicit user approval SHALL be required to save the alternate as an independent plan; rejection/cancellation SHALL preserve the source and existing saved plans. The authoring boundary SHALL validate links, ownership, identity, mutability, source-of-funds and other invariants, leveraging P1/#105 rather than cloning unrelated canonical IDs. A successful save creates a traceable separate plan, not an overwrite of the baseline.

### PFA-ADV-018 — Safe preview and authoritative simulation
After validation, a draft MAY receive a **clearly labeled provisional deterministic preview** without first being saved, provided the authoritative engine supports evaluating a non-persisted scenario safely. If that capability does not exist, the guide SHALL not pretend that an uncommitted preview was computed. Material unsupported/invalid branches SHALL be blocked or surfaced explicitly. For saved or eligible draft scenarios, simulation SHALL use authoritative engine/run interfaces and provenance, retain source run results when a rerun fails, and respect current performance/worker and cache budgets. Expensive stochastic reruns SHALL require a separate explicit user request/approval and SHALL surface cost/latency limits; no background high-cost run is implicit in an AI conversation.

### PFA-ADV-019 — Fair alternative-plan comparison
Plan outcomes SHALL be compared to the identified baseline using a compatible common Forecast Basis, horizon, engine/tax/calibration assumptions and evaluation fidelity where available. If comparison bases differ, the UI SHALL identify differences, offer normalized reruns when supported, and SHALL NOT attribute non-comparable changes solely to the user's decision. Explanations SHALL distinguish decision changes from assumption changes, display material cash-flow/liquidity/retirement/tax effects only where supported, indicate stochastic uncertainty when available, and preserve partial/unsupported/stale statuses.

### PFA-ADV-020 — User-directed iteration and lifecycle
Users SHALL be able to refine an alternate draft conversationally, change or reject individual extracted inputs, rerun the valid revised draft, save under a new independent plan identity, and return to the original without losing it. Model suggestions SHALL remain proposed edits until reviewed. When the user later chooses to rename/delete an alternate, the application SHALL honor the plan-management authorization/recovery policy; conversational requests alone SHALL NOT bypass destructive-action confirmation. Persisted plan/scenario inputs and forecast snapshots follow their own provenance/storage semantics and SHALL NOT be copied into the interaction-preference Markdown memory.

### PFA-ADV-021 — Testable education-and-authoring journey
The implementation handoff for the future plan-authoring phase SHALL include a synthetic end-to-end journey that starts from a user question, captures ambiguous inputs safely, reviews a candidate draft, obtains explicit save approval, compares source-backed results, iterates once, and proves baseline immutability and independent save/export/import where supported. Automated verification SHALL cover invalid funding/missing law semantics, no silent fabricated facts, cancelled edits, rejected or malformed model/tool outputs, provider failure, budgeted stochastic run refusal, and cross-user/household isolation. Focused uncoached UAT SHALL evaluate whether a user can **construct and understand** a what-if plan without confusing illustration with financial advice.

## 3. Design dependencies and sequencing

- **Already useful for alpha on their own merits:** O1 typed, reviewed conversational intake and provenance (PFA-ONB); U1 source-backed field help, clarity, diagnostics, and accessible charts (PFA-UX); P1 separated planning semantics and authoritative comparable results (PFA-PLAN). These are not reclassified as "advisor prerequisite" work.
- **Optional alpha experiment only if safe and low-friction:** synthetic-data or privacy-reviewed, read-only help bound to existing supported screens. No dedicated chat system, memory persistence, financial recommendations, MCP, or provider account integration is required for R11.
- **Post-alpha education MVP:** contextual explanations, optional opt-in profile, approved provider integration, source-backed citations, bounded read access, real-user comprehension and privacy evaluation.
- **Follow-on approved capability, separately gated:** conversational draft plan construction, targeted missing-input questions, authoritative simulation preview where technically supported, understandable side-by-side comparison, iterative refinement, and user-approved independent plan saving. Depends on P1 plan/identity/duplication (#105), O1 candidate review, available scenario authoring, and existing engine/UX semantics. It is **not** a new P1/R11 deadline or current Codex authorization.
- **Deferred architecture ideas:** exact agent tool-orchestration implementation, optional MCP access from external AI clients, and conditional subscription-based model allowance versus metered API billing. Tools must obey the controlled authoring and simulation contracts; each technology selection requires its own review.

## 4. Non-goals

The guide does not make major life decisions, render tax/legal/investment advice, recommend securities/positions, trade, transact, autonomously mutate plans, invent financial records, or create a duplicate forecasting/optimization engine. Constructing a user-requested what-if scenario, simulating it, and explaining the resulting tradeoffs is within scope; prescribing which alternative to choose is not. A user choosing to act based on understanding retains decision ownership.

## 5. Example end-to-end interaction (future, not alpha gate)

1. From Retirement > Forecast, a user asks: "What if I retire at 60 rather than 65 and work part-time for three years?"
2. The guide references the selected authorized plan and existing forecast basis, asks only for material missing part-time income/start/end and spending details, and shows whether a default is illustrative.
3. The UI summarizes an **unsaved alternate**: original retirement age retained in baseline; proposed retirement age, part-time income/period, any spending delta, and unchanged source facts visible and individually editable.
4. The user approves an independent alternate plan name and explicit save; validation either commits through the existing plan-authoring interface or explains blockers without changing the source.
5. The engine computes supported forecast outcomes; where a safe transient deterministic preview exists it may run before save, otherwise only after the confirmed save. Stochastic runs require explicit opt-in.
6. The guide shows source-backed side-by-side results with matching assumptions, clear unsupported-domain caveats and plain-language explanations; it does not say which option the user should choose.
7. The user revises travel spending, compares again, and can return to the unmodified original plan.

**User validation:** required before real-user launch for source grounding, clarity, accessibility, memory controls, user-directed alternate-plan creation, and users' ability to make their own decisions after receiving an explanation.
