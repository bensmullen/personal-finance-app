# D2-B credit-card statement foundation

`proposeCreditCardStatements` implements only the bounded statement-quote phase
of #147 under PFA-DET §5.5/§5.11. It is disjoint from fixed P22 loans. Domain
types preserve logical S1–S4/S7 provenance; #149 owns their runtime adapter,
atomic funding, cash priority, ledger and state integration.

Supply one complete issuer statement per provider card account for exactly the
requested half-open cycle. Opening principal excludes interest/fees and is
already recognized. Carrying unpaid opening charges is unsupported. Dated
purchases add principal; refunds reduce principal (never bank cash or income).
Historical payments reduce their explicitly quoted components exactly once.
Itemized interest and ordinary fees add separate components. Issuer posting
dates and unique within-day sequence establish economic order. An event at the
cycle's exclusive end belongs to another statement and rejects this input.

Statement principal, interest, fees and their inclusive total must reconcile.
Explicit zero quotes are required for absent interest/fees. No APR accrual,
grace calculation, issuer minimum formula, late fee, promotion, credit balance,
HELOC feature or future statement is inferred. The admitted minimum is a
verified issuer statement amount. Allocation requires an explicit issuer order
applicable to this requested payment and balance class; historical payments
carry their own observed issuer splits, independent of the new payment policy.

Statement and due dates are separate from the cycle. The requested on-time
payment date must be on/after statement issuance and on/before the due date.
Its evidence explicitly asserts no intervening activity changes the legally
due statement balance. This API quotes the cycle AND its subsequent payment;
it does not claim that cash settles inside the statement cycle. Other windows
or activity require a new sourced balance and supported adapter semantics.

`statementLiability` and the statement claim describe the whole inclusive debt
once; principal/interest/fees are its decomposition, not additional liabilities.
`potentialPayment` uses either the explicitly requested amount or the supplied
insufficient-funding amount when partial payment is explicitly authorized;
declining partial funding proposes zero settlement. A requested amount remains
uncommitted and does not assert bank availability. `minimumUnfunded` and
`fundingStatus` expose any
shortfall; `remainingIfSettled` is conditional, never an assertion of payment.
Overpayment fails rather than being capped. Zero payment creates no settlement.
This module does not inspect or change a cash balance, reserve funds, borrow,
recognize income, calculate taxes or build a combined household forecast.

Recognition proposals arise only for postings explicitly marked
`propose_expense`: purchase/interest/ordinary fee expense or refund expense
reversal. `already_recognized` events create no new recognition. Historical
payments create none. New settlement proposals reference the statement claim
and explicitly carry `recognition: none`. A future adapter must commit each
economic fact once and preserve originating posting IDs, source evidence and
idempotency; running this pure evaluator never commits anything.

Missing or conflicting supported facts return source-linked typed diagnostics
and suppress that card's proposals. Valid unrelated cards remain individually
identifiable; overall coverage stays incomplete if any card is incomplete.
Results contain frozen copied evidence and canonical ordering. Caller data is
not frozen or mutated. Net cash, taxes and future cycles remain incomplete.

Tests consume read-only `credit_card_revolve` amounts and conditional oracle.
The separate December statement/January due/payment dates and verified minimum
quote are supplemental synthetic issuer evidence. The fixture's missing
minimum policy, `decision_required` and `integratedRuntimeEvidence: false` are
preserved. This phase does not close B1, D2-B, #147, shared funding, or D2-R5.
Local verification is prohibited; selected GitHub CI and independent PR audit
own verification.
