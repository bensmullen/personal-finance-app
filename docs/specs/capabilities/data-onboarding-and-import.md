# Data Onboarding, Import & Assisted Intake

**Version:** 0.1.0-draft
**Status:** Post-PR21 capability outline
**Requirement prefix:** PFA-ONB

## 1. Purpose

This specification governs the path from an empty/new household to a useful, validated personal-finance model. Private-alpha onboarding must test the value of the forecasting product rather than the user's willingness to manually transcribe their financial life.

Manual field-by-field entry remains a supported fallback, not the preferred private-alpha onboarding path. The product should combine structured guided entry, bulk/file import where practical, and optional conversational assistance while preserving deterministic validation, provenance, privacy, and user control.

## 2. Normative requirements

### PFA-ONB-001 — Time to first useful forecast is a product metric

The application SHALL measure onboarding effort from a new/empty household to a first useful forecast.

A first useful forecast means a user-visible current-state and forward-looking result produced from a valid minimum household model, with any missing-capability/data limitations explicitly disclosed. A screen populated primarily by unavailable/unsupported placeholders does not satisfy this requirement.

Before private alpha, the product SHALL establish and validate an explicit onboarding target from representative dry-run evidence rather than inventing a target without measurement. Where stochastic forecasting is enabled for the alpha cohort, the product SHOULD separately measure time/steps from minimum model completion to the first successful user-requested stochastic result.

### PFA-ONB-002 — Progressive minimum viable household model

Onboarding SHALL collect the smallest set of reliable facts needed to unlock useful supported outputs before requesting lower-value detail.

The application SHALL NOT require exhaustive transaction history, every optional canonical field, or complete advanced tax/investment metadata merely to show an initial useful forecast when those inputs are not dependencies of that result.

After the minimum model is usable, the application SHOULD prioritize missing inputs by their expected effect on supported outputs and explain what adding each material item would improve.

### PFA-ONB-003 — Accelerated onboarding beyond manual transcription

Before private-alpha launch, the product SHALL provide an efficient assisted onboarding path beyond field-by-field manual entry.

The private-alpha onboarding flow SHALL combine structured guided entry with at least one bulk/file-based import or extraction path appropriate to the target cohort. Supported paths MAY include transaction CSV, holdings/balance exports, portable model import, paystubs, bank/brokerage/retirement statements, loan/mortgage statements, or other deliberately supported formats.

Text or voice conversational intake MAY complement these paths and SHOULD be prototyped/evaluated when it can materially reduce user effort for household facts, goals, assumptions, approximate spending, or missing/ambiguous data.

A production bank-aggregation integration is not required solely to satisfy private-alpha onboarding if the measured assisted workflow meets the approved onboarding target.

### PFA-ONB-004 — Separate current snapshot, history, and planning inputs

The onboarding architecture SHALL distinguish at least:

- current authoritative financial snapshot data such as balances, holdings, liabilities, compensation facts, and household attributes;
- historical/actual activity such as transactions and observed payments; and
- forward-looking planning inputs such as retirement goals, planned events, spending assumptions, contribution policies, and scenarios.

Historical transaction import MAY improve spending estimation, actual-versus-forecast analysis, and provenance, but a long transaction history SHALL NOT be a prerequisite for an initial useful forecast when a sufficiently reliable current snapshot and forward assumptions are available.

### PFA-ONB-005 — AI/import extraction produces candidate facts, not authoritative model writes

Document parsers, OCR/extraction systems, LLMs, conversational assistants, voice systems, classifiers, and other probabilistic import tools SHALL NOT directly mutate authoritative financial state.

They MAY produce typed candidate facts or proposed model operations containing the extracted/interpreted value, source/provenance reference, exact-versus-approximate status, confidence/ambiguity metadata where meaningful, and unresolved questions.

Candidate facts SHALL pass deterministic schema/domain validation and the applicable confirmation/review policy before being committed to the canonical household model.

The system SHALL NOT invent a missing interest rate, balance, tax status, account type, date, or other material fact merely to complete onboarding.

### PFA-ONB-006 — Preserve provenance, precision, and uncertainty

Imported or conversationally supplied facts SHALL retain source provenance sufficient to distinguish user-confirmed statements, institution/document observations, historical imports, and model-generated assumptions.

Exact document values SHALL remain distinguishable from approximate user statements such as “about $140k” or “roughly $7k per month.” Confirmation MAY promote a candidate into authoritative user input, but the system SHALL NOT silently convert an approximate statement into falsely precise observed data.

### PFA-ONB-007 — Review and confirmation focus on material ambiguity

The onboarding flow SHALL provide a consolidated review/confirmation step for extracted candidate facts before material authoritative changes are committed.

The UI SHOULD minimize unnecessary confirmations for high-confidence, internally consistent exact imports while explicitly surfacing conflicts, missing dependencies, approximate values, unsupported mappings, and material ambiguities.

For conversational intake, follow-up questions SHOULD target missing high-value facts rather than reproducing a long static questionnaire.

### PFA-ONB-008 — Imported facts are idempotent and duplicate-aware

Bulk/file imports SHALL preserve source identity and/or deterministic idempotency keys where available so re-importing the same source does not silently duplicate authoritative facts or transaction history.

Imports that may overlap an existing account, position, liability, transaction set, or previously confirmed candidate SHALL detect the potential duplicate/conflict and require an explicit merge/replace/ignore decision when it cannot be resolved deterministically.

### PFA-ONB-009 — Raw documents, transcripts, and AI providers obey the privacy boundary

Raw uploaded statements, paystubs, transaction files, voice recordings/transcripts, and extracted candidate data are sensitive financial data.

Before real private-alpha users submit such data through a shared service, ingestion SHALL be covered by the same authentication, household authorization, transport/storage protection, logging/redaction, deletion/export, and retention controls required for other private financial data.

If a third-party AI/extraction provider is used, the implementation SHALL undergo an explicit privacy/data-handling review before real alpha data is sent to that provider. Only data necessary for the task SHOULD be sent. Raw documents/transcripts SHALL NOT become permanent canonical financial records by default and SHOULD be deleted or expire after successful extraction/review unless a documented product/recovery need requires retention.

Pre-private-alpha engineering MAY use synthetic documents/conversations or real personal data only within the already-approved local personal-data boundary.

### PFA-ONB-010 — Privacy-safe onboarding instrumentation

The product SHALL collect enough onboarding telemetry to identify friction without logging raw financial values, document contents, transcripts, account numbers, or other unnecessary sensitive data.

Before and during private alpha, onboarding measurement SHOULD include where technically practical:

- elapsed time to minimum valid model / first useful forecast;
- completion/abandonment rate by onboarding stage;
- count of manually entered fields or steps;
- count and type of imported/extracted candidate facts;
- number of user corrections/rejections;
- import/extraction success and unsupported-format rates;
- number of unresolved high-impact missing inputs; and
- source-path mix (guided entry, file import, conversational intake, portable model import, etc.).

Telemetry SHALL use non-sensitive event/aggregate metadata consistent with the privacy architecture.

### PFA-ONB-011 — Private-alpha onboarding readiness gate

Before inviting friends/family into private alpha, representative onboarding dry runs SHALL demonstrate that intended users can reach a useful model/forecast without requiring burdensome manual transcription.

The approved onboarding target SHALL be documented after dry-run measurement and SHALL include at least elapsed-time and manual-effort criteria. R11 may establish the pre-infrastructure target using synthetic/local-safe dry runs; private-alpha launch SHALL additionally verify the workflow end-to-end through the secured shared-service persistence/authentication boundary.

If the measured workflow misses the target, launch SHALL be blocked until onboarding is simplified, additional import/extraction support is added, or the alpha cohort/scope is deliberately narrowed.

### PFA-ONB-012 — Supported-format scope is deliberate and observable

Private alpha does not require universal statement parsing or production bank aggregation.

The product SHALL explicitly identify the document/file/institution formats it supports, fail safely on unsupported formats, and track which unsupported formats are encountered during onboarding. Support SHOULD be expanded based on target-cohort frequency and onboarding value rather than attempting exhaustive compatibility up front.

A partially recognized file SHALL NOT silently commit a partial authoritative model without showing which material fields/rows were omitted or unresolved.

## 3. Initial private-alpha intake strategy

The preferred private-alpha pattern is:

```text
guided household/goals intake
        +
current-account / holdings / liability / income imports where practical
        +
optional transaction history import
        +
text/voice follow-up for missing assumptions and goals
        ↓
typed candidate facts
        ↓
deterministic validation + conflict detection
        ↓
consolidated user review / confirmation
        ↓
canonical household model
        ↓
first useful forecast
        ↓
progressive requests for high-value missing data
```

Likely useful early adapters include:

- portable model import/export;
- generic transaction CSV;
- brokerage/retirement holdings or balance exports where stable formats exist;
- current bank/retirement/brokerage statements;
- mortgage/loan statements;
- paystubs or compensation summaries;
- guided structured forms for household/tax/planning facts;
- guarded text/voice conversation for goals, rough spending, life events, and missing fields.

Exact adapters are chosen from private-alpha cohort needs and measured onboarding return on implementation effort.

## 4. Design boundary

AI assistance is an application-boundary interpretation tool. It does not perform authoritative financial arithmetic, bypass canonical validation, or become the source of truth for model state.

The authoritative flow is:

```text
source document / CSV / user statement / conversation
        ↓
deterministic parser and/or AI extraction
        ↓
candidate structured facts
        ↓
validation / provenance / conflict checks
        ↓
user confirmation where required
        ↓
canonical model mutation
        ↓
deterministic/stochastic financial engine
```

This capability SHALL reuse the existing provenance, model-version, migration, identity/idempotency, privacy, and authorization contracts rather than creating a parallel financial-data model.
