# Isolated Series EE issue-vintage proposals

`proposeSeriesEE` implements issue #147 B2-2 under PFA-DET §5.6/S1–S8,
PFA-INV-027 and PFA-TAX-015. All results are immutable, conditional,
uncommitted `d2-shared/v1` proposals. This module has no runtime registration,
bank posting, ledger writer, tax calculator, market feed or automatic redemption.
#149 owns account/lot state, exclusive claims and funded settlement; #101 owns
tax interpretation/integration. This does not close #147 or the D2 gate.

The caller supplies original-owner purchase/acquisition/face facts, owner and
beneficiary, named funding source, wrapper cash destination and a committed
opening checkpoint. Only ordinary single original-owner taxable lots are
admitted. Inheritance, special/education redemptions, unknown wrappers and
unreconciled original purchase basis are explicitly gated. Face and cost remain
distinct, allowing sourced discounted original purchases without using face as
the interest basis.

An official or externally verified, issue-specific fixed or historical schedule
must explicitly supply every completed monthly interval from the issue month,
period interest fractions, monthly cent rounding and capitalization frequency.
The supported convention rounds each month's interest on the last capitalized
balance, holds that interest pending, and adds it to capital only on the sourced
capitalization boundary. Historical rows may vary; no annual advertised rate is
converted or reused. Other posting/compounding conventions require further
support. Month boundaries are Gregorian first-of-month dates; mid-month and leap
dates receive only completed months. Future/missing intervals never extend the
last supplied rate. Explicit projected/unavailable sources stay incomplete.

The source also supplies first redeemable date, penalty cutoff/month count,
eligible guarantee date/multiple, and stop date. A guarantee tops up the purchase
multiple once in full replay, with uplift separately identified. Opening
carrying is reconciled to the same replay, so subsequent observations recognize
only the change. The last sourced monthly interest credits supply forfeiture;
no flat percentage penalty or missing early history is invented. Guarantee
uplift is excluded from the admitted interest-only forfeiture convention.
There are no monthly cash coupons, and accrual ends at the sourced stop date.

Sources need explicit publication, asOf, effective coverage, law/vintage version
and known-at admission. Full accrual intervals must be covered. Evidence later
than an observed event cannot justify that event even when hindsight known-at
is later. Redemption requires an event-date source-qualified quote matching the
entire calculation. Quote-only catalog examples therefore cannot become
computed vintage or tax evidence. An ordinary redemption proposes wrapper cash
equal to the eligible quote, removes reconciled opening carrying and purchase
basis, and recognizes only their economic difference. Redemption claims are
lot-wide across dates/checkpoints; #149 must enforce exclusivity and checkpoint
currency atomically. Pure replay does not reserve or consume a claim.

Federal character requires an explicit sourced election and previously
recognized interest. Redemption character excludes that prior interest. Current
accrual character requires a fully recognized opening and same-tax-year
checkpoint; cross-year attribution and previously taxed forfeiture are gated.
State and local exemption each require independent jurisdiction law. Missing or
nonconforming state law does not fabricate a state payment or suppress valid
federal character. Unknown purchase carry basis leaves basis and dependent tax
coverage incomplete and prevents a redemption proposal. No result asserts tax
liability, withholding, settlement due or tax paid.

Tests are synthetic isolated evidence, including illustrative sourced
twenty-year guarantee and thirty-year stop terms. These terms and all synthetic
rates live only in tests. The existing `ee_redemption_quote` and
`ee_accrual_timing` fixtures remain unchanged and conditional. Required normal
architecture/unit/typecheck/build/E2E preflight belongs to GitHub Actions;
local verification and CI polling are prohibited during this implementation.
