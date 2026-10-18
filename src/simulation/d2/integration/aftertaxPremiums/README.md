# Optional C1 after-tax premium execution adapter

`attachAftertaxPremiums` consumes an existing immutable compiled household kernel,
an explicit run `asOf`, C1 request and exact confirmed C1 proposal occurrences.
The caller supplies stable expense and primitive UUIDs **per occurrence**, a
source-qualified owned BANK account, coverage-qualified existing payable and
authored VS2 settlement priority. Use the same identities for replay and split
requests; use distinct identities for different dates, quotes and payers. The
household run context must use the supplied `asOf`.

The adapter always regenerates proposals with unchanged `proposePremiums` and
compares confirmations exactly. It admits only verified sources known at `asOf`,
one exact cent currency, monthly schedules with full calendar-month coverage,
and the exclusive non-Medicare `aftertax_bank` route. Each occurrence becomes a
month-bounded VS2 `RecurringExpenseStream`, retaining its exact scheduled date,
zero inflation, stable source lineage and one all-or-nothing named-bank funding
policy. `applyHouseholdExecutionOverlay` installs those streams. Run the returned
kernel with `runHouseholdKernel`; the adapter itself performs no transactions,
claims, funding, priority resolution or state mutation. Net-cash coverage here
describes admission, not a promise that settlement will succeed.

Every overlapping existing income/expense stream requires a dated source-linked
representation declaration. A distinct obligation must carry its own source's
trace. An equivalent expense must carry the quote source trace and match all
bounded dates, amount, ownership, recurrence, bank, payable, inflation and funding
semantics; only then is that generic stream replaced. Income netting and broader
generic streams cannot be replaced. Renamed source quotes cannot bypass existing
premium plan/month identity or shared-member coordination. Missing proof blocks
the affected coverage. No automatic account discovery, generic insurance fallback,
new cash-pool priority or payroll/tax treatment is inferred.

Exact reattachment returns the same kernel. Changed facts or identity collisions
fail admission. Each coverage is admitted atomically; other valid coverages may
still attach. Source-linked S7 diagnostics explain incomplete obligations, while
unchanged C1 diagnostics remain separately available as `domainDiagnostics`
(including deferred tax characterization). Unsupported payroll, SSA deductions,
Medicare/IRMAA, partial months, annual/bespoke recurrence and future/unverified
sources append no expense for the affected coverage. Empty input preserves the
baseline kernel. This adapter does not wire canonical/editor input into defaults
or complete C1/D2. See the independent integration evidence under
`test/d2/integrated/aftertaxPremiums/README.md`.
