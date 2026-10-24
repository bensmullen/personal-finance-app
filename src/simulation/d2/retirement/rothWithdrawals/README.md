# A4-3 conditional ordinary owner Roth IRA cash withdrawal

`evaluateRothWithdrawals` composes the unchanged public A3-2
`evaluateRothOrder` contract with A4 source, cash, owned bank, withholding and
authorization conventions (PFA-DET §5.3/§5.4, PFA-DET-017/018). It never invokes
the pre-tax withdrawal evaluator. This domain-local helper has no runtime,
compiler, canonical schema, ledger or tax-owner integration.

One input covers one owner, tax year, batch and opening snapshot. Supply the
entire original `RothOrderInput`, including exhaustive owner accounts, regular
contribution history, conversion/rollover vintages, explicit same-year ordering,
qualification and independent five-tax-year clocks. Its proposals are attached
unchanged to matching cash candidates; this helper neither recomputes nor
persists their allocations or taxable-character facts. Missing ordering evidence
discards the entire batch, with no invented zero taxable amount.

The additional cash register must match the owner account inventory exactly.
Each account has one independently sourced actual cash holding, distinct from
every account container, with the exact opening available cash passed to A3-2.
Liquidity is settled at or before that snapshot and includes all external
reservations. A3-2's exhaustive unchanged-activity window covers all event dates;
its cumulative account cash cap therefore applies to this same cash, including
three or more competing requests. No market value, inferred sale or borrowing
supplies capacity. An account containing several cash holdings requires an
authenticated aggregate cash holding at this seam; this helper does not invent
an allocation between holdings.

Each request must match the original ordering operation, owner, withdrawal,
authorization, gross and date. Separate batch, instruction and proposed receipt
IDs are bound by the distribution authorization to the original cash holding,
bank institution/account/kind and exact withholding remittance terms. Identities
cannot alias roles or be reused in the supplied exhaustive usage register. The
usage operation/withdrawal registers must reconcile exactly to A3-2 history;
historical distribution authorizations must appear in usage too. Usage evidence
is scoped to the household (`personId:"*"`, as in A4) and explicitly attests this
owner's Roth register as of the same opening snapshot. Historical remittance
authorizations/instructions/receipts/batches also belong in these registers.

The destination must uniquely match a dated, sourced, owned checking/savings
bank inventory row. Each request requires a full dated withholding jurisdiction
inventory, including explicit zero instructions, and independent remittance
authorization provenance. Every remittance's exact amount, beneficiary,
jurisdiction, destination, route and authorization identity must match the
distribution authorization. Missing instructions/amounts are incomplete. Sources
must be verified, known by the event and knowledge cutoff, effective in a
half-open window, and free of conflicting IDs across both modules. Distinct
documentary rule snapshots/jurisdictions for bank and tax evidence are allowed;
A3-2 still enforces its single ordering-rule snapshot without alteration.

Candidates reconcile gross cash decrease at the holding, net owned-bank increase
and withholding advance-payment intents, using exact USD cents. The account
container is not debited again. Principal movement is net-worth-neutral and adds
no wage income or personal-consumption expense. The attached Roth proposal alone
supplies conditional component character and qualifying flags. Funding, bank
settlement, tax liability, penalties, withholding-credit settlement and future
law remain incomplete; every result is uncommitted and non-postable. Receipt IDs
name prospective receipts, never proof that cash has posted. Ordinary owner cash
only: inherited, QCD, in-kind, corrective/excess, hardship and other special
routes remain incomplete. RMD satisfaction is outside this seam.

Evaluation is pure and all-or-none: one invalid request discards all candidates
without reserving cash, authorizations or basis. Output containers are detached
and deeply frozen; caller containers are untouched. A3-2's date/approved-sequence
order determines hypothetical economic precedence. Reordering independent input
facts preserves candidate names, amounts and sorted trace references.

Synthetic tests in the new disjoint test subtree cover exact-cent decomposition,
three-request contention, one-cent overdraw, separate clocks, history/usage
reconciliation, source cutoffs, routes, authorizations, missing withholding,
replay and immutability. GitHub CI owns ordinary verification. #149 owns actual
BANK/lot transfer, raw-evidence authentication, persistence and atomic execution
revalidation; PFA-TAX/#101 owns authoritative law, liability and settlement. This
phase does not close consolidated issue #146 or those integration owners.
