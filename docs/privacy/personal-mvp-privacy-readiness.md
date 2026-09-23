# Personal-MVP privacy readiness review

- Review date: 2026-09-22
- Scope: single-user Personal MVP within the trusted-origin boundary defined by ADR-017
- Result: the ADR-017 privacy/persistence boundary is ready for the developer's single-user use once the PR 21 functional gate is satisfied; **not** Private Alpha or multi-user security readiness

## Verified implementation boundary

The repository, tests, Golden Household, documentation, and browser flows use deterministic synthetic identities and economics. No real personal financial data, credentials, secrets, or personal screenshots are included. The review found no financial model content written to URLs, committed logs, telemetry, static assets, or CI artifacts, and the application has no telemetry or financial-model network service.

`ui/persistence/indexedDbPersonalModelStore.ts` rejects `*.github.io` and insecure non-loopback HTTP before opening IndexedDB. HTTPS origins other than `*.github.io`, plus HTTP/HTTPS loopback (`localhost`, `127.0.0.1`, `::1`, `[::1]`), follow ADR-017. Public/demo origins remain in-memory/import-export only and show a synthetic/demo warning telling users not to enter real financial data.

The IndexedDB adapter persists one opaque string: the exact portable canonical-model JSON produced by the portability authority. Save and Load are manual; there is no autosave or autoload. Forecast settings, execution owners and instructions, liability profiles, retirement bindings, contention policy, compiler/simulation state, navigation, forecasts, comparisons, and explanation state are session-only and are cleared on replacement/import/load. Migration validates and imports the candidate before atomic replacement; failure preserves the previous exact bytes for backup/export.

## Threat and recovery disclosures

Browser-local IndexedDB is not encrypted at rest by this application. Same-origin script execution and people with access to the device or browser profile remain inside the documented threat model and may be able to access stored data. Portable JSON exports are plaintext and must be stored securely.

Browser storage can be cleared and is not the sole backup. Portable export, including exact saved-byte backup export, remains the recovery mechanism. Confirmed local deletion removes the saved browser copy without deleting the open in-memory model or exported files.

## Deferred beyond this milestone

Authentication, authorization, server persistence, multi-user isolation, managed backups, production monitoring, and a reviewed encryption/key-recovery design remain Private Alpha or later concerns. This review makes no claim that those boundaries are ready.

## Verification note

One broad local `codex:verify` pass is justified after focused checks because PR21 intentionally changes the canonical fixture, three compiler/application domains, household read models, scenario execution, persistence-sensitive UI state, and the browser acceptance surface together. Focused tests are used while iterating; the broad pass is reserved for the completed integration.
