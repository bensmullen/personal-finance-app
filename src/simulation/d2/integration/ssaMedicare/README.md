# Opt-in SSA / Medicare same-event settlement

Issue #149's bounded physical slice consumes one actual A1 coordinated monthly
SSA installment and one complete C2 member-month. Positive deductions are full
Part B/D obligations; independently sourced zero other Parts create no claim.
`attachSsaMedicare` is the household entry point. No shared editor or automatic
source discovery is enabled.

The adapter recalculates `coordinateSocialSecurity` and
`composeMedicareObligations`, binds exact award, recipient, worker, entitlement,
coverage, provider, plan, route, month, base, surcharge and legal source lineage,
and obtains `prepareSsaMedicareDeductionProposals` approval. Explicit effective,
published and known verified-zero withholding is mandatory. All source facts
must also be available by the run data cutoff.

State owns one source-specific atomic candidate transition. A single registered
inward-facing source qualification port makes that transition and receipt import
re-evaluate A1/C2 without a state-to-simulation import. Conditional proposals,
caller-supplied receipts and completeness flags never authorize posting. The
ordinary bank-funded settlement API is unchanged.

For the synthetic $1,500 gross / $80 B / $120 D example, the sole journal debits
the existing owned BANK $1,300 and Medicare expense $200 and credits SSA gross
income $1,500. Opening BANK $2,000 becomes $3,300. Three positive same-event
claims have three distinct recognition identities and three separate full
settlement identities. A fully deducted installment omits the zero cash leg.
Preaccrued premiums and partially settled SSA rights require a separate clearing
contract and are rejected.

The optional `ssaMedicarePayments` record stores versioned private source inputs,
explicit zero withholding, source-consumption identities, the actual canonical
journal, recognition facts and distinct claim/settlement histories. It is created
only with successful posting. Import validates the complete receipt against the
posted identity registry, exact journal, claims and freshly qualified sources.
An identical completed receipt suppresses repeated participant execution;
changed evidence fails closed. Source evidence is the same trusted external-input
boundary as A1/C2; replay fingerprints do not authenticate SSA/CMS publications.

Descriptors declare the actual payment instant and BANK production. Preparation
rejects unproven built-in contention; the existing candidate observer seam also
rejects unproven peer-participant BANK work. A direct successor dependency after
the payment is supported. No scheduler priorities are inferred.

Detail and summary use the same transaction and state transition. The existing
portable codec seam restores immutable inputs in a fresh process. Sparse v3
checkpoints retain receipts and reject invalid receipt removals; older v1/v2/v3
artifacts retain exact absence when this optional record is missing.

Social Security provisional-income treatment, Medicare deductibility and
projected tax remain incomplete. Executed gross income, premium expense and
verified-zero withholding are reported separately; no tax credit is fabricated.

CI oracles are in `test/d2/integrated/ssaMedicare/settlement.test.ts`, with a
separate fresh-process replay worker and synthetic source fixtures. They cover
the exact journal and statements, independent claims, reversed request order,
two payment months, 13/24 monthly detail/summary runs, portable checkpoint resume,
legacy absence, full deduction, duplicates, source/identity/withholding failures,
preaccrual/partial-right rejection, forged histories, tampered deltas and BANK
contention rollback. Source-owner installment boundaries are covered in the
existing C2 coordination regression file. Codex does not run these tests locally;
GitHub Actions, independent semantic audit and PM merge approval remain gates.
