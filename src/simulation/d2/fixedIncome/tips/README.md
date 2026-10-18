# Isolated TIPS proposal boundary

Implements the bounded issue #147 TIPS phase under PFA-DET §5.6/S1–S8,
PFA-INV-027 and PFA-TAX-015. `proposeTips` accepts an explicitly observed event
and read-only committed opening checkpoint. It returns immutable, conditional,
uncommitted proposals; #149 alone adapts these to holdings, cash, basis and tax
owners. No market-data fetch, clock lookup, inflation projection, ledger writer,
tax payment, purchase execution or nominal Treasury amortization is present.

Only ordinary single issuance-at-par lots are admitted. The caller supplies
verified dated issue/lot/funding/wrapper facts, an issue-specific CPI series,
Gregorian lag/interpolation, observed monthly points, reference denominator and
all rounding policies. Reference CPI is rounded once from the exact rational
`a + (b-a)*(day-1)/daysInCurrentMonth`; its rounded ratio is applied to original
face, then principal is rounded to cents. The day-one reference needs only `a`.
Publication and asOf must be known, and observation months must have ended.
The supplied base is authoritative evidence; it is not reconstructed from an
invented issue-date CPI history.

Opening carrying, basis and cumulative indexation must reconcile to opening CPI
under the explicitly admitted signed-indexation basis convention. The helper
proposes only the difference from that checkpoint. A coupon requires a sourced
scheduled interval and year fraction and applies its annual decimal rate to
indexed principal. Intervening coupon dates require separate processing.
Deflation requires the explicit signed convention; special lot/basis cases,
sales, splits, early redemptions and adjusted settlement calendars are gated.

At maturity, an eligible sourced original-par floor applies. Indexed carrying
and basis are removed once, cash receives redemption principal, and any floor
uplift is identified separately from both the coupon and previous accretion.
No redemption tax gain is inferred. A taxable floor uplift remains incomplete
for tax characterization pending separate law. Taxable coupon/OID/deflation
facts require dated, jurisdiction-specific signed-character law; a sourced state
exemption yields zero taxable character, while missing state law stays incomplete.
Deferred wrappers require their own no-current-facts law and emit no fabricated
contemporaneous OID. Cross-year taxable indexation needs a tax-year checkpoint.
Tax coverage describes these character facts only, never liability or payment.

A verified quote may supply a separate cash coupon when indexation is missing.
Its kind is `quoted_coupon`, with no computed reference/ratio/principal claim;
indexation, basis and dependent tax coverage remain incomplete. Computed and
quoted coupon routes share one stable exclusive claim. All claims include owner,
wrapper, issue, holding, lot, basis and event date; operation IDs additionally
identify the opening checkpoint. Adapters must enforce claim exclusivity,
checkpoint currency and atomic admission before committing anything. Replaying
the helper has no committed effects.

Each dependent output has S7 coverage. Settlement always remains incomplete for
the shared owner. Conditional catalog examples and `integratedRuntimeEvidence`
are unchanged; the synthetic tests here are isolated evidence only. This phase
does not close #147 or claim Series EE, full D2-B, tax integration or UI support.
