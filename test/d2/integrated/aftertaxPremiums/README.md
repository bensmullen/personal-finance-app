# #149 bounded physical integration evidence

Evidence source: `aftertaxPremiums.test.ts` in this directory. These are synthetic,
independent integration assertions for later S8 review, awaiting GitHub CI. They
do not promote any preparation catalog case's status or evidence tier, complete
C1/D2, authorize automatic compiler input, or establish merge readiness.

| Test reference | Physical evidence asserted |
| --- | --- |
| `health_after_tax executes real recognition` | Reads unchanged prep amounts and opening cash; real household VS2 debit expense / credit payable, then debit payable / credit named bank. $1,000 → $700 cash, $300 expense once, $300 net-worth reduction; one claim/recognition/settlement. Summary forecast also executes. |
| `does not turn the employer subsidy` | Only member share enters expense and bank settlement; no employer cash income. |
| `insufficient bank cash` | Full real payable and shortfall, unchanged $100 cash, no settlement, $300 expense, $200 negative ending net worth. |
| `replays exact cross-month` | Two monthly claims and $700/$400 cash; split admission equals whole admission; actual forecast-window replay reproduces detailed February transactions, provenance, shortfall and ending state. |
| `premium_end_exclusive` | Reads unchanged prep coverage boundary; no C1 quote, appended stream, transaction, claim or cash movement. |
| `health_pretax_employer` | Reads unchanged prep shares; sourced payroll proposal remains incomplete with no appended expense. |
| `replaces an exactly equivalent` | Unproven generic expense rejected; source-qualified, economically exact bounded equivalent replaced, with one expense; differing amount rejected. |
| `competing-expense priority` | Existing VS2 authored priority pays the competing expense first; premium retains its payable and real shortfall. |
| `two separately sourced coordinated providers` | Two explicit distinct-source declarations and C1 member coordination retain distinct streams, claims and $600 total expense. |
| `renamed quotes` | Renaming a coverage/quote/stream does not authorize another charge for an existing plan/month. |
| `gates` / `identity overlay` | Missing confirmation/source/bank/payable, wrong payer, future source, forged shares, identity collision, unsupported recurrence/partial coverage/Medicare/SSA/payroll, mixed/unknown currency, sub-cent precision and uncoordinated overlap are gated; empty input preserves baseline. |

Local verification is prohibited for this implementation turn. Normal GitHub
architecture, typecheck, unit, build and E2E gates and an independent semantic
audit remain required. Refs #149; keep the issue open.
