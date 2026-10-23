# Contextual Financial Education Advisor

**Version:** 0.1.0-draft
**Status:** Proposed future capability; no alpha launch obligation
**Requirement prefix:** PFA-ADV

## 1. Purpose and product boundary

Define an optional, contextual AI guide that helps people understand their household finances, application terminology, and supported forecasts so they can make their **own** decisions. This is an education-and-comprehension capability, not a discretionary financial planner, broker, portfolio recommender, or automated actor.

The first supported experience is **read-only and non-advisory**: explain what a financial figure means; show where it came from; explain assumptions, uncertainty, and limits; translate labels; help users navigate to pertinent app screens; and answer questions about *existing* source-backed forecasts. It may suggest which *information* to inspect next, but not which financial action or investment to take.

Future interactive plan proposals, tool orchestration, additional simulations, or an MCP adapter are **ideas**, not approved implementation or private-alpha requirements. Any future expansion must be separately specified and approved. A user-visible product name such as "Financial Guide" is preferable to implying a regulated adviser relationship.

## 2. Normative requirements

### PFA-ADV-001 — Education-only initial scope
The initial guide SHALL teach and interpret; SHALL NOT give personalized investment advice, choose or recommend securities, positions, trades, allocations, or transaction timing; SHALL NOT claim fiduciary/professional status; and SHALL NOT present a financial action as the user's required or best decision. It MAY explain general financial concepts, observed account characteristics, portfolio terminology, and *already-modeled* tradeoffs without prescribing actions. Expanded recommendations require an explicit product/regulatory decision and new governed requirements.

### PFA-ADV-002 — Contextual rather than chat-first assistance
The default entry points SHALL be embedded in the relevant household summary, forecast visualization, metric, financial field, plan/scenario, and diagnostic where supported. Contextual help SHALL inherit an authorized, stable **reference** to the active view, selected plan, metric, run, and Forecast Basis rather than asking the user to restate them. A conversation panel MAY supplement the experience, but SHALL NOT be the primary navigation or comprehension prerequisite. Context switches SHALL be visible to the user.

### PFA-ADV-003 — Financial literacy adaptation without judgment
The guide SHALL express concepts in clear, respectful language appropriate to a user-selected or user-confirmed familiarity level; offer progressively deeper calculation/rule explanations; define unfamiliar terms in context; and avoid implying that inferred literacy or appetite is a financial fact or suitability determination. Users SHALL be able to ask for simpler or more technical explanations without changing canonical financial assumptions.

### PFA-ADV-004 — Grounding and financial authority
Material numerical statements about a household or forecast SHALL be grounded in authorized authoritative read models or source-backed engine results. The guide SHALL identify whether a number is historical/current, an assumption, deterministic projection, probabilistic result, or missing/unsupported; SHALL retain meaningful period, units, model/run provenance, and freshness; and SHALL NOT invent missing financial data or maintain competing tax, investment, or cash-flow calculations.

### PFA-ADV-005 — Limitations and uncertainty remain visible
Explanations SHALL preserve unsupported/partial domains, missing data, stale results, forecast assumptions, non-comparable Forecast Bases, and uncertainty. The guide SHALL distinguish a simplified educational explanation from a complete financial conclusion; SHALL NOT turn a forecast into a guarantee; and SHALL direct the user to relevant assumptions or source details when a conclusion materially depends on them.

### PFA-ADV-006 — Read-only default and action separation
Initial advisor privileges SHALL be limited to authorized contextual reads and explanatory navigation. Future simulation requests, draft proposals, plan edits/creation/deletion, and external actions SHALL be separate, typed, permissioned capabilities with explicit user review, validation, least-privilege authorization, and audit/recovery policies; nothing in this specification authorizes their implementation now. Model text SHALL NOT be an executable command or an implicit approval.

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
A future typed, permission-controlled, auditable tool orchestration gateway and a future MCP adapter are independent **evaluations**, not architectural prerequisites for the first education-only read surface. If built, they SHALL reuse the same authoritative read models and validation/authentication boundaries as the application; neither an LLM nor an MCP tool SHALL directly manipulate canonical state. Provider-specific tool schemas SHALL be adapters, not domain financial authority.

### PFA-ADV-013 — Resilience, accessibility, and transparent AI status
Contextual explanations SHALL be clearly identified as AI-generated, be accessible via keyboard/screen reader/touch, and degrade to ordinary application context/help when a provider is unavailable, a user declines AI, or a budget is exhausted. The app SHALL NOT conceal underlying source details or block ordinary financial workflows on an AI failure.

### PFA-ADV-014 — Explicit verification and adoption gates
Before any feature is enabled for real users, independently verify reference/Forecast-Basis grounding, unsupported/stale explanations, cross-household denial, profile consent/edit/delete controls, prompt-injection isolation, cost ceilings, and education-versus-advice boundaries with synthetic fixtures and focused user-comprehension evaluation. No version of this capability is a mandatory R11/private-alpha exit requirement absent a later explicit product-owner roadmap decision.

## 3. Design dependencies and sequencing

- **Already useful for alpha on their own merits:** O1 typed, reviewed conversational intake and provenance (PFA-ONB); U1 source-backed field help, clarity, diagnostics, and accessible charts (PFA-UX); P1 separated planning semantics and authoritative comparable results (PFA-PLAN). These are not reclassified as "advisor prerequisite" work.
- **Optional alpha experiment only if safe and low-friction:** synthetic-data or privacy-reviewed, read-only help bound to existing supported screens. No dedicated chat system, memory persistence, financial recommendations, MCP, or provider account integration is required for R11.
- **Post-alpha education MVP:** contextual explanations, optional opt-in profile, approved provider integration, source-backed citations, bounded read access, real-user comprehension and privacy evaluation.
- **Future ideas:** plan/simulation tool orchestration, draft/approval flows, MCP access from external AI clients, and conditional subscription-based model allowance versus metered API billing; each requires its own implementation decision.

## 4. Non-goals

The initial guide does not make major life decisions, render tax/legal/investment advice, recommend securities/positions, trade, transact, autonomously mutate plans, invent financial records, or create a duplicate forecasting/optimization engine. A user choosing to act based on understanding retains decision ownership.

**User validation:** required before real-user launch for source grounding, clarity, accessibility, memory controls, and users' ability to make their own decisions after receiving an explanation.
