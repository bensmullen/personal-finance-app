# U1B-B0 chart read-model foundation — architecture contract

**Status:** ChatGPT architecture audit and implementation proposal, 2026-10-17; **not** evidence that an adapter has been implemented or U1B-UAT approved. Authoritative finance semantics remain in `src/application/householdProjection.ts`, `src/simulation/householdProjection.ts`, `src/simulation/tax/contracts.ts`, current tax/funding rules and PFA-UX-007/009/015–023. Existing [U1B Issue #120](https://github.com/bensmullen/personal-finance-app/issues/120) owns UI/chart delivery, while B0 is a deliberately disjoint **read-only adapter preparation lane**, not a second editor/UX task.

## 1. Audit: what the current model actually exposes

- `PersonalHouseholdForecastReadModel` is `unavailable` or `completed|incomplete`; the latter includes `openingSnapshot`, ordered monthly `points`, `requestedHorizon`, `reachedThrough`/`stoppedAt`, `asOf`, `dataCutoff`, `actualHistoryAvailable:false`, `diagnostics` and source `traceIds`/`traceRefs`. Each `HouseholdForecastPoint` includes `cash`, `investmentValue`, `totalAssets`, `totalLiabilities`, `netWorth`, `statementIncome`, `statementExpenses`, component cash-flow statements, debt balances, and metric-specific `outputCapabilities`. The opening snapshot includes opening cash/assets/liabilities/NW, but is not an actual-history chart.
- **Critical cash definition:** `deriveHouseholdClosingMetrics()` sums `state.accounts[*].cash` across **all** containers. The period `cash` is **total modeled account cash, including brokerage/retirement-wrapper cash**, not an automatically spendable checking/savings balance. Opening accounts are individually identified but period points do **not** expose individual account cash. B0 must call the series **Total modeled cash**, not accessible/bank cash. The narrower bank-cash metric is **unsupported by the current summarized series** until an authoritative scoped snapshot/replay adapter exists.
- Statements `statementIncome` and `statementExpenses` are **recognized income/expense measures**, not bank inflows/outflows or net deposited wages. Phase B may show an accurately labeled **Modeled income vs expenses** chart using these, but must not sell it as realized checking cash flow, gross-to-net allocation, or after-tax spendable pay.
- `src/simulation/tax/contracts.ts` maps `cash`, `totalAssets`, `totalLiabilities`, `netWorth`, `statementExpenses`, debt and other tax-affected fields to `outputCapabilities[field].status=complete|incomplete`; `statementIncome` is explicitly tax-independent. A result-wide `status:incomplete` cannot be treated as every metric unsupported or as every metric complete. Opening snapshot is tax-independent, not a statement about all projected months.
- `inspectMonthlyMoney(point, model)` performs a replay-verified selected-month categorization, currently `withholding:'not_modeled'` and `status:'incomplete'`. It is **not** a complete disposable-income read model. Don't add whole-history replay to chart rendering. #101 owns real paycheck withholding.
- `personalMvp.ts` separate liability occurrence models include scheduled/extra principal, interest and funding status. Grouped asset-class attribution or retirement income by stream are **not** demonstrated by the household summary result.
- `src/time/index.ts` builds **contiguous UTC month-boundary** periods: `[start,end)`, often `T00:00:00.000Z`. Year grouping must use calendar year of period **start** only when source months are validated to be complete UTC calendar months. An actual period crossing a year boundary without a split contract must not be prorated.
- The UI lifecycle in `interactiveForecast.ts` already distinguishes running, stale, incomplete, unsupported, error and identity/fingerprint. A chart-series adapter consumes an immutable **resolved result** and must not own lifecycle/cache/worker identity or generate an invented fingerprint. `sampleForecastChart()` uniformly selects ≤120 points and may obscure narrow deficits/shortfalls; it is NOT an economic aggregation and must not be used to decide full-resolution chart outputs.

## 2. B0 independently implementable minimal slice

**Proposed exclusive files:** `src/application/forecastChartData.ts` and `test/forecastChartData.test.ts`. The former is an **immutable, pure selector** importing existing public forecast types and exact `Money` arithmetic only. Do not modify `src/application/index.ts`, `src/application/householdProjection.ts`, compiler, simulation, tax, UI, shared CSS, worker, golden fixtures, `e2e/**`, or existing U1 tests. Consumers may import the new module directly once merged.

**Inputs:** one `PersonalHouseholdForecastReadModel`; optional external run/result fingerprint supplied by the consumer when genuinely known (never synthesized); granularity `monthly|annual`. No model input, no simulation, no request to execute or replay anything. A status-`unavailable` result yields an explicit `unavailable` series with no data; no exception for ordinary supported-unavailable status.

**Output fields:**
- Period identity `[periodStart,periodEnd)`, UTC, granularity and covered-month count; requested/reached cutoff, actual-vs-projected marker and currency.
- Per-metric exact amount string and independent `complete|incomplete|unavailable` status; source trace **IDs** only, not serialized replay artifacts or whole `traceRefs`.
- Initial time-zero opening **snapshot** with `periodKind:'opening'`, not fake historical time series.
- Metrics: `totalAssets`, `totalLiabilities`, `netWorth`, `totalModeledCash`, signed `totalModeledCashChange`, `modeledStatementIncome`, `modeledStatementExpenses`, optional `totalInvestmentValue` and `totalDebtPrincipal` (sum named debt principal balances only when the period list covers the corresponding liability scope; do not assume all debt is represented otherwise).
- Denominator/interpretation metadata: `totalModeledCash` = **all account cash**; statement income/expenses = **recognized statements**. Explicitly mark `bankCash`, payroll disposable income, investment attribution and by-source retirement income as **not supported by this selector**. No permissive metric aliases that invite misuse.

**Exact monthly mapping:**
1. Validate same currency, valid contiguous UTC monthly periods, strict date order, no duplicates, and `netWorth == totalAssets - totalLiabilities` using exact existing Money arithmetic. Reject/make unavailable on invalid identity or arithmetic, not silently fix an inconsistent source.
2. Preserve raw numeric strings exactly where unchanged. Missing/incomplete `outputCapabilities` means do not infer `complete` merely from numeric presence. Missing one metric's capability must not hide unrelated complete metrics.
3. Cash change of first forecast month = `point[0].cash - openingSnapshot.cash`; later months = `point[i].cash - point[i-1].cash`, **only when consecutive valid compatible scopes**. Amount may be negative/zero, no clamping. Mark status at least as incomplete if either endpoint is incomplete. This number is a **change in total modeled cash balance**, not salary less expenses, net operating cash flow, bank cash flow or an explanation of funding.
4. For gaps, partial tax periods or a `reachedThrough` shorter than requested horizon, do not invent periods, interpolate values or connect visually disconnected months. Preserve partial numeric results with explicit status/coverage; use a null/unavailable marker where no supported value exists. Do not call a projected period historical because its start is before `asOf`: `actualHistoryAvailable:false`.

**Annual aggregation:**
- Group validated complete UTC source month periods by calendar year. Assets, liabilities, net worth, investment value and ending modeled cash are **stocks**, so annual values are the **last supported observed year-group closing value**.
- Statement income/expenses and cash change are **flows**, so annual values **sum all source months** in the group using exact decimal arithmetic. Annual cash change should also equal end cash minus opening cash **only if the contiguous same-scope period coverage is complete**.
- Label an incomplete opening/closing calendar year `partial_year` with covered `from/to` and month counts (e.g. a plan running March–December is never a fully modeled calendar-year total); do not annualize or extrapolate it. Annual metric is incomplete when any contributing month is incomplete/unavailable, missing, in an unmodeled horizon, or has incompatible currency/basis.
- Preserve **all** exact source periods for drilldown. Never use sampling to compute annual totals. Formatting/decimation belong to the consumer and cannot erase extremes/deficits/shortfall markers. There must be no silent 120-point cap on economics.

**Status and lifecycle:** Chart selectors report source metric coverage only (`complete|incomplete|unavailable`). `loading/running/stale/error/cancelled` are **external UI forecast lifecycle**, never inferred from period amounts. The UI chooses whether to show an explicit stale prior result based on worker fingerprint; this adapter cannot silently mix old and new results. A missing fingerprint is `unknown`/omitted, not a guessed stable ID.

**Defensive contract:** no long-horizon O(N²) replay; one pass, bounded O(N) memory for monthly/annual points, with negligible overhead versus forecast. No `JSON.stringify` of full replay artifacts per point. Return readonly/frozen structures where consistent with existing public DTO practice. Fail normal corrupted inputs explicitly rather than returning a misleading complete chart.

## 3. Acceptance tests for B0

1. **Golden real readout:** use existing `test/personalHouseholdProjection.test.ts` household builder *read-only* to derive a short forecast; validate opening anchor, monthly sample counts, exact totals and unchanged input JSON. Do **not** modify source golden fixtures.
2. **Three-line identity:** `assets - liabilities = netWorth` for each period; deliberate arithmetic mismatch or currency mismatch fails explicitly; preserve legitimate negative net worth.
3. **Cash wrapper distinction:** demonstrate a household with retirement/brokerage account cash where modeled total cash **exceeds** checking/savings. `totalModeledCash` must not claim accessibility or bank-only cash.
4. **Signed cash movement:** first month vs opening, next month vs prior, negative/zero changes, changed opening balance, no fabricated cash flow source.
5. **Stock vs flow:** two monthly periods spanning annual boundary; annual stocks use last valid closing; annual income/expenses and changes sum exactly. Test 12-month complete year, partial year, leap-year boundary and a gap. No integer/float precision loss.
6. **Per-metric tax coverage:** cash/NW/statement expenses incomplete while statement income may remain complete; negative-space tests ensure unavailable output isn't plotted as complete or equal zero.
7. **Partial horizon/no history:** `reachedThrough` and `stoppedAt` leave requested future uncomputed; source result `unavailable` is an empty unavailable dataset. `actualHistoryAvailable:false` preserved.
8. **Immutability and bounds:** source forecast unchanged; no worker/replay/traceArtifact/engine execution imports or calls; point extraction linear in N, not one ledger replay per point.
9. **Compatibility:** TS typecheck and focused new unit tests in GitHub CI only. Do not run browser, screenshot, dev server or expensive full-household stress in a Codex implementation turn.

## 4. Later chart dependencies — explicitly excluded from B0

| Display | Existing evidence | Required separate readiness |
| --- | --- | --- |
| Cash screen **bank-only accessible cash** | Only opening per-account cash, projected **all-account** cash | Account-specific period cash readout from a single authoritative view or replay, including account type/owner and restrictions, approved before labeling spendable |
| Cash gross-to-net allocation | `inspectMonthlyMoney()` month replay, but `withholding:not_modeled` | #101 tax/paycheck contract plus bank-vs-investment funding sources; full allocation may only show partial/unreconciled meanwhile |
| Real Estate mortgage interest and principal **paid** | Period debt balances, separate liability occurrence and `inspectMonthlyMoney().mortgages` | Verify actual posted cash and debt reductions; scheduled/extra terms not necessarily funded. Cumulative principal repaid ≠ home appreciation/equity |
| Planning retirement by source | Aggregate statement income, retirement milestones | Per-person/plan/category traced stream readout, SS/pension/distribution support and genuine tax/benefit capability gating |
| Investing attribute/per-class drivers | Total `investmentValue`, realized/unrealized/fees snapshots | True opening-to-closing valuation/flow bridge, net external funding, gains/fees/price effects, no double count or made-up decomposition |
| Long horizon | Request boundary and `reachedThrough` | Age-90 UI choice does not bypass existing 40-year run window; no synthetic horizon extension |

## 5. Concurrency, authority and merge sequence

**U1B-A** Codex Issue #120 currently owns `ui/**`, `app/globals.css`, `e2e/**`, `test/**`. B0's **only** new test file is `test/forecastChartData.test.ts`; A must not intentionally edit that non-UI test file. B0 owns **only** `src/application/forecastChartData.ts` and the new matching test; it must not touch existing U1B-A files, entry exports, application compilers or shared financial facts. The broad A `test/**` authority is syntactically overlapping, but actual planned file ownership is disjoint; if concurrent Codex work tries to edit the same file, stop B0 and serialize.

B0 can be coded from merged current `main` **only after** the required task contract and milestone-register PR are merged. It can be reviewed/audited as a small isolated PR and merged before or after U1B-A without a React merge seam. U1B-B frontend work must wait for A to merge and consume the B0 adapter from merged main. If B0 discoveries demand changes to `householdProjection.ts`, taxes, registry, household compiler or UI, **stop and return to ChatGPT/PM**: separately authorize a shared integration task, do not silently broaden B0.

**No PM authorization to merge or start Codex inferred from this planning artifact.** Final U1B acceptance remains with Issue #120's uncoached PM UAT. D2 tax/capability research belongs to the independent D2 discussion and must not block the source-only B0 dataset adapter.
