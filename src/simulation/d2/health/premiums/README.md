# D2-C quoted premium foundation

`proposePremiums` is the first isolated #148 phase under PFA-DET §5.8–5.11,
PFA-INS-013 and PFA-TAX-015, merged in #155. Its private types preserve the
logical `d2-shared/v1` identity, dated-source, proposal, diagnostic and evidence
boundaries. #149 owns conversion to shared runtime interfaces.

Supply explicit household/member/plan identities, sourced member eligibility,
half-open civil-date coverage, a single payer route, and one gross quote with
exact Money employer/member shares. The quote includes its effective rule
window, publication, as-of date, jurisdiction, version and projection status.
No external lookup or ambient clock is used. Caller evidence is an admitted
input, not a determination of statutory eligibility by this module.

Each monthly/annual interval occurrence uses the full quoted amount. The caller
must explicitly select `per_occurrence_no_proration` and missing-day `skip`;
this API does not invent partial-month charges, refunds or rollover dates.
Amounts must already fit their currency's minor-unit scale, so no rounding is
implicit. A family quote appears once with all covered members; member rows
must never be summed as duplicate premiums. Only `memberAmount` is the proposed
household-funded share; `employerAmount` creates neither household spending nor
salary. Different jobs require explicit end/start facts. Concurrent coverage
requires sourced coordination admitting distinct premiums; coordination cannot
override duplicate recurrence or Advantage/Medigap incompatibility.

Medicare Parts A/B/D, Advantage, Medigap and authored supplements require an
explicit per-person elected configuration with enrollment and compatibility
evidence. A person can use named bank funding without receiving SSA. A verified
SSA deduction route is represented only as a pending adapter proposal. The
module never computes CMS law, MAGI lookback, IRMAA, SSA deductions, wage bases,
tax savings, bank payments, recognition or ledger/state effects. Every Medicare
total remains incomplete pending C2/#149, even if its base quote is known.
Net cash and tax effects remain incomplete for shared #149/#101 integration.

Malformed identities, periods, recurrence or unbalanced/negative/sub-minor-unit
money reject the request. Unadmitted membership, payer/source/election facts,
unknown quote windows and overlaps produce bounded affected-output diagnostics
and suppress the affected coverage's proposals. A quote must cover the whole
requested intersection with that coverage; otherwise this conservative API
suppresses that coverage rather than presenting a partial sum as complete.
Unrelated admitted coverage can still yield proposals. Results are copied and
frozen; stable occurrence IDs support downstream idempotency but do not commit
or reserve anything.

The disjoint tests under `test/d2/health/premiums` consume the independent
`health_after_tax`, `health_pretax_employer`, `premium_end_exclusive` and quoted
Medicare fixture amounts. Supplemental test enrollment/source facts are
explicitly synthetic. Original fixture capability and integrated-evidence flags
remain unchanged. These tests cover isolated quote scheduling only; healthcare,
C2/C3, shared reconciliation, D2-D and owner UAT remain open. Codex does not run
local verification; GitHub CI and independent latest-head semantic audit own
verification of this implementation.
