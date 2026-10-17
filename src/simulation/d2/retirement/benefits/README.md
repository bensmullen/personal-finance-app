# D2-A quoted benefit foundation

`calculateQuotedBenefits` is a pure, isolated calculation boundary for PFA-DET
§5.1 and the `d2-shared/v1` logical seams in §5.11. It does not complete #146,
PFA-DET-016, PFA-TAX-015, D2 or R5. #149 owns the physical shared adapter,
canonical identity validation, recognition, funding, settlement and atomic state
commit; #101 and the tax engine own tax and withholding-credit interpretation.

The caller supplies verified payment evidence. `BenefitSource` records snapshot,
publication, jurisdiction, family, version and dated status; projected/unavailable
evidence cannot qualify a verified schedule. This module does not retrieve or
authenticate publications. Its trusted boundary is an already verified quote,
not an unreviewed user estimate. All examples in the tests are synthetic.

Each award preserves household, recipient, worker, sponsor and beneficiary IDs.
`entitlementId` identifies the underlying entitlement across quote revisions;
`awardId` identifies the supplied award/quote record. Payment operation/claim IDs
use household, entitlement, payee and civil payment date, so replay and requoting
cannot invent a second settlement identity. Overlapping duplicate entitlements
are rejected together. Different pensions may coexist, but overlapping SSA
awards to one recipient require a single externally coordinated total quote.
The module never sums a full spousal/survivor award with an own award.

For SSA, `VerifiedAward` attests to eligibility, earnings-test resolution and
coordination for the named recipient, worker and claiming month over a specific
half-open horizon. Unsupported family/divorced/survivor exceptions remain
incomplete. Survivor awards require the worker's death fact to match that
verified eligibility result. Worker death and recipient death are different
facts. A post-death own/spousal payment needs revised verified terms; this phase
conservatively gates it. Missing eligibility is never an inferred full award.

The quote identifies its actual claiming month and dollar-basis date. `at_claim`
gets no further claiming adjustment; `full_retirement_age` requires an explicit
sourced multiplicative adjustment. Pensions require an election-matched
`post_election` participant quote, with no second actuarial election reduction.
Each source must explicitly admit the supported adjustment/rounding sequence:
claiming adjustment, chronological COLA factors, then survivor continuation.
Other sequences require a new verified quote, rather than an invented formula.

COLA is a complete sourced event list over an explicit covered horizon. An empty
list attests to no change only within that horizon. Each event supplies a civil
effective date, matching year, dimensionless multiplicative `Ratio` (e.g. 1.02,
not 0.02 for a 2% increase) and rounding policy. Events already included in the
quote's dollar basis are not applied again. Later events apply on their exact
effective dates, including admitted events before commencement. Nothing is
extrapolated beyond evidence coverage. Money uses existing exact `Money`/`Ratio`
helpers; quote/instruction amounts must be nonnegative and fit currency precision.
Factor rounding may be at currency precision or a coarser sourced scale.

The quoted amount is one whole installment at the supplied frequency, not an
annualized amount to be divided by twelve. Monthly and annual installments use
the commencement day and an explicitly sourced `skip` invalid-day convention.
All periods and stops are half-open civil dates. There is no proration, timezone
conversion, payment-in-arrears inference or benefit-month-to-bank-date inference.
The caller supplies a verified commencement/payment calendar convention.

Pension mortality uses `participantDeathDate`/`beneficiaryDeathDate`. A sourced
continuation specifies the exact payment transition date, beneficiary, fraction
of the COLA-adjusted elected installment, rounding, optional exclusive stop and
whether pre-commencement death is covered. Fractions 0, partial and 1 are supported;
no continuation terms means unknown continuation, not zero. Payments between
death and a later sourced transition retain the participant's quoted terms.
Known beneficiary death gates continuation unless an explicit stop excludes it.
Participant withholding/Medicare instructions do not transfer to the beneficiary.

Results contain uncommitted gross recognition/settlement candidates, source
references, due-installment recipient/month rows and deduplicated diagnostics.
Unknown rows omit gross money; no-payment dates create no candidate. Global
gross coverage is incomplete even when unaffected payments can be proposed.
Tax and net-cash coverage are always explicitly incomplete. Authored withholding
and a potential Medicare deduction are separate instructions: neither subtracts
from gross here. No taxable SSA amount, pension basis recovery, tax credit,
Medicare premium, spendable cash, account movement or posted ledger is calculated.

The request is bounded to 64 awards and a 1,200-month span, with at most 1,200
COLA entries per award. Diagnostics deduplicate repeated code/award pairs and
refer to the requested period; incomplete month rows retain affected dates.
Invalid request envelopes throw, while missing/unsupported award facts diagnose
incompleteness. Inputs are never mutated, and inventory order cannot choose an
economic winner. Proposal order is canonical award ID then civil payment date.

`test/d2/retirement/benefits/quotedBenefits.test.ts` consumes the six named D2
fixture identities read-only. Only independently supplied gross/withholding
facts are oracles; eligibility and plan evidence are explicit additional test
inputs. Original conditional capability labels and confidence remain untouched.
Tests also cover sourced schedules, mortality, precision, replay and gating.
Ordinary GitHub CI owns execution; no local verification is run in this turn.
