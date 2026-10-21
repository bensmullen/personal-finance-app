# D2-B isolated HELOC draw-phase evaluator

`proposeHeloc` implements only the current B1 phase of #147 under PFA-DET
§5.5 / PFA-DET-019 and the logical S1–S8 `d2-shared/v1` contracts. #149 owns
the physical adapter, authoritative state, cash funding, posting, conflict
priority and consolidated net worth. This module imports no fixed-loan or
credit-card evaluator and changes no household state.

All inputs must be explicitly authored and source-qualified. One request is
one contractual interest posting period, with opening principal already
recognized and no unpaid capitalized interest. The owner and borrower must be
the same person in this bounded implementation. IDs distinguish the line,
liability account and named bank. Separate sources cover the contract, cap,
opening state, phases, interest terms, events, funding and each index quote.
Verified sources must match these identities and cover the applicable interval.
Contract terms must be available at period start; events at their dated
occurrence; index publications at reset and at evaluation. Publication and
as-of dates are both preserved. Synthetic test evidence supplies no market
assumption or generally applicable loan terms.

Supported rates are nominal annual millionths with an explicit prior reset
rate, next reset ordinal and a positive fixed calendar-day reset interval
(up to 3660 days). Calendar-month resets, alternate index selection, negative
index-plus-spread variants and other conventions require separate admission.
Every reset in the half-open period must be supplied; there is no extension of
the prior rate beyond its next reset. Index lookback selects exactly the dated
observation, never the latest quote or a future estimate. Round index plus
spread to the explicit increment, then clamp to the intersection of the
symmetric up/down initial or recurring change cap, lifetime bounds and optional
sourced legal maximum. Ordinal one uses the initial cap; subsequent resets use
the recurring cap. Null legal maximum explicitly means no additional ceiling
under the sourced contract. Caps may produce an off-increment final rate.

Events and resets carry unique within-day source sequence numbers; all take
effect before that day's accrual. Input array order conveys no economic
precedence. A draw requires its own explicit authorization and unused credit
at that point in the cumulative sequence. Repayment requires positive authored
principal and unique sufficient external funding evidence. This evidence is
conditional and does not reserve cash or establish a bank balance. #149 must
validate and consume funding atomically. Each movement depends on preceding
movements; downstream code cannot safely cherry-pick a later draw after
rejecting a repayment on which its credit availability depends.

The supported evaluation calendar spans years 0101–9899. Money uses existing
exact `Money` values in two-decimal currencies, converted
losslessly to integer cents internally. Interest is simple ACT/365-fixed or
ACT/360 on daily principal, with a common exact rational denominator. Sum
unrounded segment accrual and round once to cents at the exclusive period end
using explicit half-up or downward rounding. No daily rounding, compounding,
capitalization, fees, implicit draws, tax deductions or home valuation is
inferred. The interest expense proposal and claim are separate from the later
uncommitted payment intent; settlement recognizes no second expense and leaves
principal unchanged. Zero interest creates no settlement intent. Interest
recognition depends on the conditional principal movements, and settlement
depends on that recognition. Interest posting at period end is the boundary output of
this request and must be idempotently recognized once by #149.

Every principal movement has equal cash and liability deltas and zero income,
expense and net-worth change. Candidate states and closing principal remain
conditional on execution of all movements. They do not assert funded draws,
paid obligations or a committed liability. The single liability is not an
additional account-container liability. Recognition and settlement operation
IDs derive from line and period, so replay preserves identity.

Invalid or unsupported facts produce typed, period-linked incomplete
diagnostics and suppress every proposal in the request. Coverage describes
only this isolated draw-phase quote, not a complete household forecast.
Amortization conversion, balloon service and periods at/after maturity are
explicitly unsupported. A later period requires a newly sourced opening state
and prior reset facts; candidate state never automatically becomes committed
input. Complete B1 and the remaining B2/B3/#149 work remain open.

Tests read the immutable conditional `heloc_draw` and `heloc_reset` prep
fixtures, retaining their missing-rate and `decision_required` status. The
added verified synthetic contract/index evidence supports isolated assertions
only. Local execution of tests/builds/validators is prohibited in this task;
GitHub CI and independent audit own verification.

## B1 phase-servicing source boundary (#147, PR #220)

`proposeHelocPhaseServicing` is a separate, immutable, **uncommitted** amortizing/balloon installment proposal. It never extends the interest-only `proposeHeloc` public contract, posts a journal or changes bank/liability balances. The supported period-end installment requires the original line/borrower, a reconciled canonical opening principal checkpoint, matching phase/calendar/rounding terms, dated authorization/funding for authorized or settled payments, and separate recognition of principal versus interest. Final fees and balloon balance require independent contractual quoted source.

When B1 has complete verified rate/reset/index evidence, even an independently quoted statement must reconcile **exactly** with the B1 interest calculation; a differing quote is rejected, not preferred. Where B1 cannot compute solely because a rate is absent, an index observation is missing, or the interest convention cannot be computed, a separately sourced **original complete issuer statement** may qualify `method:"issuer_quoted"` using `terms.issuerQuote`. The issuer document must have distinct provenance, matching line/borrower/accounts, entire period, due date, opening/closing balances, interest, principal, fees, total and publication/as-of at the completed period boundary and no later than the due date. Missing, projected, stale, partial, conflicting or non-independent documents are incomplete. Invalid identity, B1 source conflict, invalid phase, funding, caps, negative amortization and other unsuitable B1 failures do not become valid merely by attaching a quote.

The isolated `issuer_quoted_uncomputed` evidence label **does not assert that B1 arithmetic was verified**; downstream physical admission must authenticate original issuer evidence and claim exclusivity independently. Both compute and issuer-only paths use the same stable B1 interest claim, recognition and settlement identities. A payment's `status:"settled"` is documentary only: it never constitutes a canonical bank debit, accrued interest expense, settled liability, an actual tax deduction or net-worth change. Follow-on #149 owns atomic physical integration and tax remains incomplete. Synthetic tests exercise quote-only missing-rate, source-window rejection, exact interest disagreement, requalification/carry-forward, final balloon and immutable replay.
