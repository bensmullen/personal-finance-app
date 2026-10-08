# U1 implementation evidence — issue #94

The machine-readable inventory is `ui/authoring/fieldContract.ts`. Its explicitly
registered fields contain classification, label, meaning, unit, format, example,
state, source, dependencies, and suggestion policy. Rendered required/read-only
state follows the authoritative descriptor or workflow. Schema additions do not
automatically become normal controls. `GuidedFields` rejects unregistered normal
labels, and `PercentageInput` rejects unregistered percentage controls.

| Journey | Shared presentation / authority | CI evidence |
| --- | --- | --- |
| Initial setup, salary and structured facts | FieldShell; staged entity save; immutable facts preserved; structured facts technical/read-only | U1 browser navigation and existing immutable/structured editor coverage |
| Plan and simulation dates | Shared errors; existing horizon replacement adapter; valid half-open monthly run window | U1 field contract and browser horizon/repair assertions |
| Mortgage terms, maturity and extra principal | Existing mortgage schedule suggestions, explicit maturity correction, existing operation adapter and projected-payoff read model | Existing D1 mortgage browser assertions plus U1 contradiction controls |
| IRA / brokerage contributions | Contextual destination; checking/savings selector; existing personal purchase adapter | Existing contextual save/export test and U1 account-path test |
| Workplace / HSA contributions | Compatible destination characters and same-owner gross salaries; employer-only matching; existing payroll adapter | U1 choice contract and account-path browser assertions; existing export assertions |
| Return assumptions | Exact percentage conversion; linked deterministic assumption; collapsed card editor | Existing return/save/rerun browser coverage |
| Tax payments / refunds | Explicit accounts, validated following-year date, confirmation reset on edits | Existing tax setup/export coverage; U1 setup path |
| Invalid inputs and diagnostics | Inline errors, direct repair/focus opening ancestor disclosures, global setup and saved-fact summaries; original engine diagnostic grouping retained | U1 browser focus/disabled-save assertions; existing diagnostic grouping assertions |
| Responsive / accessible help | Shared input geometry, keyboard/click/touch disclosure, label and help relationship | Browser geometry at 1440px / 390px and keyboard-help assertions |
| Save, reload, import | Existing model persistence and D1 adapters; session setup remains explicit | Existing persistence and import/export browser tests adapted to explicit save |

No local tests, typecheck, build, browser run, validators, dev server, or package
installation were performed. Added/updated tests await GitHub Actions. Browser
console cleanliness and geometry are assertions awaiting execution, not claimed
observations. Independent ChatGPT UX/semantic audit and uncoached product-owner
UAT remain external acceptance gates. This implementation does not close D1.

Product-owner UAT goals: create/edit personal and payroll contributions; configure
and change a mortgage; change planning/forecast dates; run/update a forecast; fix
an incomplete setup; interpret a partially modeled tax result; edit salary and
investment return. Acceptance includes first-impression organization and cognitive
load. These goals deliberately contain no implementation-specific click recipe.
