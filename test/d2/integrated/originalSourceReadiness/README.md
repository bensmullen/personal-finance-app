# S8-4 original-source readiness oracle — conditional evidence

Issue #149; evidence tier **conditional**. This test-only audit combines three
independent original providers for `synthetic-household` / `person`. IRA's port
has person scope only; household membership is fixture context, not additional
publisher authentication. There is no shared publisher or cross-domain claim lock.

The common observation/forecast boundary is **2040-06-01T00:00:00.000Z**.
IRA and EE receive CivilDate `2040-06-01`; FSA receives the explicit Instant.
These are retrospective synthetic observations: FSA plan/paychecks are in 2026,
EE's single owned January 2026 issue has an April redemption illustration, and
IRA original filings cover 2025–2028 (three annual calculations, not a monthly
simulation). Forecast execution is absent. Later-known originals are rejected;
an amendment first known in 2041 cannot contaminate a 2040 replay.

`iraOriginals.ts`, `eeOriginals.ts`, and `fsaOriginals.ts` adapt the independently
authored literal examples from the merged year-chain, EE source-binding, and FSA
payroll-binding tests. Existing tests/fixtures are unchanged and are not imported.
IRA annual declarations and registry facts are separately instantiated; EE pins
hash an independently authored original; FSA fetches a separate plan/history,
contribution inventory and signed original journals. No calculated result is
recycled into any original. All publications are synthetic, not tax, Treasury,
employer, or authenticated runtime evidence.

Literal cents establish IRA opening/closing basis `20000 → 18000 → 16200 → 0`,
recoveries `2000 / 1800 / 16200`, taxable amounts `8000 / 8200 / 3800`; EE
conditional redemption `10303`, original cost `10000`, federal interest `303`;
FSA two distinct employee `10000` occurrences and separate employer `2500` grant.
The EE 1% monthly convention is illustrative, not inferred law. Every result
retains its domain's noncommitted/nonpostable contract and incomplete physical
funding/tax/settlement fields.

Read-only snapshots cover all inputs, original journals, EE opening holdings and
IRA filings before/after evaluation and replay. Signed wage journals remain
$1,000 gross = $815 cash + $70 positions + $115 withholding credits each.
Those historical facts are not posted again. No kernel state is instantiated,
no bank/stock/net-worth balance store is fabricated, and no writer is invoked.
Thus this proves source qualification and nonmutation, not funded runtime
integration or physical household balance reconciliation.

## Unresolved producer → consumer → physical owner seams

| Original producer | Conditional consumer | Missing #149 integration owner/surface |
| --- | --- | --- |
| Independent filing registry, original Form 8606 history and annual IRA inventory | `evaluateIraBasisYearChain` | Persisted original return/basis state, funded IRA→Roth position and balanced conversion journal, separate tax liability/settlement; shared annual IRA/529→Roth capacity owner (conversion is not contribution capacity) |
| EE original lot/cost, issue-vintage schedule, quote and jurisdiction rules | `bindSeriesEESources` | Canonical owned bond position/basis checkpoint, wrapper cash owner and atomic redemption journal/claim reservation; wrapper-to-bank transfer and tax-year interest recognition/settlement |
| FSA employer plan/election/history, #101-shaped signed wage journals, separate grant authorization and wage-base sources | `proposeFsaPayrollBindings` | Physical employee wage reduction replacing the correct payroll occurrence once, separate employer grant funding, Section 125 jurisdiction tax bases/withholding credit reconciliation, entitlement reimbursement settlement owner |
| All three independently dated source inventories | This read-only test evaluates the three consumers separately | Shared atomic settlement, durable idempotent claims, committed household cash/positions/net-worth reconciliation, original-tax-year persistence and deterministic cross-year replay without repeated income/benefit recognition |

These are the next real integration surfaces, all **unresolved** here. No source
port proves cross-domain physical exclusivity, tax coordination, 529 capacity,
or final S8 acceptance. No TIPS binder is imported. The 55 preparation fixtures,
13/25-month retirement runtime oracles, U1 #120 and stochastic R5 gates remain
unchanged. This proof does not close #149 or D2.

Adverse tests first qualify all domains, then change one publication, identity,
claim or journal and compare the unaffected two outputs. Missing, withdrawn,
amended/revised, future-known, digest/vintage and duplicate-paycheck cases fail
closed. Independent input permutations and identical replay remain deterministic.
The 1→2→4 growth guard selects distinct EE/FSA conditional events from this one
household (no duplicated redemptions or additional lots), budgets at most 6 KB
per event plus framing, and checks the complete three-domain result for absence
of raw appendix markers, schedules, journal legs, withholding and revision
inventories. It is a bounded serialization guard, not a stress benchmark.

GitHub CI and an independent ChatGPT semantic/provenance/payload/negative audit
remain required before PM merge approval. Local preflight, if available, is only
the repository's optional bounded helper and is not acceptance evidence.
