# D2-A A2 ordinary contribution capacity proposals

`evaluatePlanContributions` is a pure, bounded `d2-shared/v1` domain seam for
403(b), governmental 457(b), federal TSP, SEP IRA and SIMPLE IRA. It returns
uncommitted contribution candidates and person/year/scope/version usage and
headroom proposals. It does not fund accounts, modify a capacity registry,
reduce wages, compute deductions, post transactions or settle tax. #149 owns
S1/S2/S4/S5/S6 physical adapters; #101 owns payroll/tax.

Inputs are readonly and Money is the existing immutable exact decimal value.
All amounts must be nonnegative integral currency minor units, with strictly
positive proposed contributions. Nothing is clipped or rounded. Source-qualified
limits and compensation caps are supplied values, with no real-year constants,
employer formulas, law downloads or deduction calculation in this module.

Each request carries person, sponsor, legal plan family, destination, enrollment,
dated ordinary contribution character, funding source identity, stable source
reference, eligible compensation and an explicit plan permission. Employee
payroll intents and employer owned-asset intents are disjoint. Employer additions
never emit a household cash debit. Roth needs explicit permission. Non-Roth
after-tax is bounded to explicitly permitted 403(b) additions. Catch-up, SARSEP,
nongovernmental 457, rollovers and distributions are capability-gated.

Rules, enrollment, compensation, funding and observed usage identify source,
jurisdiction, publication, effective year/period, as-of date, version and status.
Only verified sources known by the evaluation as-of date are admitted. Projected,
unavailable, uncovered and missing rules yield incomplete diagnostics. A verified
test supplement is explicitly synthetic, not evidence of actual statutory law.

The caller supplies each applicable capacity's maximum and complete current-year
prior usage **before** `asOf`, separately identifying its rule authority and usage
observation source. Candidate dates must be on/after `asOf` inside the half-open
evaluation and enrollment periods. Missing observations never mean zero. The
adapter must include observed committed operation IDs to reject replay against
committed state; identical evaluation against unchanged observations is pure.
Stable source references also reject repeated requests under different operation
IDs within the same batch and contribution character.

The minimum legal scope roles are:

| Route | Required scopes, in addition to sourced compensation capacity |
| --- | --- |
| 403(b)/TSP employee ordinary deferral | aggregate deferral, annual additions |
| 403(b) authorized employee after-tax | annual additions |
| Governmental 457 employee deferral | governmental 457 |
| Governmental 457 employer addition | governmental 457, employer |
| 403(b)/TSP/SEP employer addition | annual additions, employer |
| SIMPLE employee deferral | SIMPLE deferral, aggregate deferral |
| SIMPLE employer addition | employer |

Aggregate deferrals include supplied prior 401(k) usage and source-qualified
SIMPLE cross-plan interaction. The three person-wide scopes require aggregation
identity `person`; changing plan or employer cannot hide their usage. Annual
additions/employer/compensation scopes use explicitly sourced legal aggregation
identities, including controlled employer groups where applicable. The source
permission must attest the complete scope list and can require additional scopes.
This module enforces minimum roles, but cannot independently reconstruct an
omitted controlled group or verify a source's legal claims. S2/S5 authorities must
supply those facts. Duplicate legal scopes or competing versions fail closed.

A batch is atomic: if any request, scope or cumulative cap fails, every candidate
and usage proposal is withheld. Unaffected requests in that rejected batch carry
`ATOMIC_BATCH_REJECTED`. Partition independently evaluated accounts/periods into
separate calls where partial admission is desired. Sorting is presentation only;
it never gives earlier input a capacity allocation preference. Maximums are 256
requests, 2,048 prior scopes, 64 permissions per plan and 32 scopes per permission.
Malformed envelopes/oversized batches throw; request facts yield bounded typed
diagnostics. Account/period completeness covers only contribution capacity. Tax
and funding always remain incomplete and postings are not applicable.

The isolated tests consume the five unchanged contribution catalog cases with
their authored 50,000-cent amounts, source identities and explicit synthetic
supplements. They cover shared/independent scopes, prior 401(k) usage, multiple
people/employers, source character, cumulative exact cents, replay/order,
effective/year boundaries and atomic multi-cap failure. Conditional fixture
labels remain unchanged. GitHub CI owns execution; no integrated household,
payroll, tax, distribution, rollover or real statutory catalog evidence is claimed.

Authority: PFA-DET §5.2/§5.11, PFA-DET-017, PFA-INV-025 and PFA-TAX-015.
Owner #146; physical common execution #149. A1 benefits and A3/A4 remain separate.
