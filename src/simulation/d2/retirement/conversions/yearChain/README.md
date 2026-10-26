# Conditional original-return IRA basis continuity

`evaluateIraBasisYearChain(input, provider)` implements the isolated portion of
PFA-DET §5.3 authorized by #146: one person, consecutive tax years, USD and the
existing restricted annual Form-8606 convention. It calls the annual calculator
once per independently qualified year, and compares the resulting carryforward
with that year's original filing. The next opening must reference that same
original filing/version and exact carryforward. The first opening also requires
its previous year's independent original filing. Missing years and duplicate
years/operation IDs/underlying transaction IDs gate the affected chain.

The provider is a trusted application dependency, separate from authored annual
inputs. Its implementation must authenticate the original filing and the current
publisher's filing/revision history for the requested person, tax year and run
cutoff. This module supplies the typed consumer seam, not document ingestion or
an authentication implementation. Do not construct a provider by returning the
annual input, trusting its `original` flag, or comparing a document hash alone.
There is no fallback provider or fabricated filing evidence.

History includes publisher identity/version/publication, authority and revocation
status, source observation, original filing/status, and a complete dated revision
inventory. The inventory's `completeThrough` and `checkedAt` must equal the run's
inclusive `knownAt` cutoff. Its query must match `knownAt` and `asOf` exactly.
Original documents/publications and observed sources must be available by `asOf`
and known by `knownAt`; the history observation itself must equal `asOf`.
Later-known revisions do not affect an earlier run; any
known revision, including a withdrawn/corrected/superseding record, gates this
original-only model. A missing or stale inventory cannot attest absence of
amendments. History lookup failures return typed incomplete coverage.

Annual inputs optionally carry `originalReturn` attribution on opening basis and
closeout. Legacy annual-only callers retain their existing pure calculation and
reconciliation-snapshot convention. The chain requires both attributions and
matches their filing identity, version, classification, owner, year, status,
dates, exact amount, source and legal snapshot against independent history.
Explicit prior-return provenance permits its own verified prior-year legal
snapshot; missing law cannot default to the following year's law. Current-year
source and rule checks remain strict, and closeout provenance must match the
current annual legal snapshot. No numerical Form-8606 computation changed.

Results are frozen compact per-year conditional evidence: filing/rule IDs,
coverage/reasons, exact annual gross, taxable amount, recovered/remaining basis,
and distribution allocations with stable operation/transaction IDs. Gross and
taxable totals include all annual distributions; conversion requests merely
reference the annual register. Output does not embed annual inputs, inventories,
documents, rule catalogs or provider histories. Size grows with distinct years
and distribution occurrences. A later failure retains earlier immutable evidence
and gates dependent years. No computed output is installed as an opening input
or represented as a filed return.

All results are uncommitted and non-postable; tax liability, funding and basis
persistence remain incomplete. There is no shared state, ledger/tax integration,
filed-return ingestion, amended recomputation or full D2 closeout claim. GitHub CI
and independent semantic audit remain merge gates.
