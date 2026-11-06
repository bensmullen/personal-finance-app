# D2-D stage E (#280)

This suite consumes the merged S1 household route, S1b native receipt and S1c
VS2 expense interfaces. No state or VS2 implementation is changed here.

Composition registers the BANK original publisher separately from issuer and
elected-coverage publishers. `CardBankSourcePort.householdPublisherId` binds
its genuine issuer reader to the native economic-original authority. The
optional source-owned `householdBank` document binding selects native v2;
omitting it retains historical Person-owned v1 receipts. The issuer original
remains a NONBANK expense/liability journal. Its payment is one BANK debit.

`registerAftertaxPremiumSourcePort` registers the original elected coverage
reader. It independently reconstructs a raw C1 request/confirmation and the
ordinary VS2 expense/settlement journals, including occurrence, period, cents,
trace metadata, Person payer, beneficiary and authentic observation context.
The source digest covers its raw request, physical confirmation and publication
metadata; it detects amendments but never substitutes for registration.
`ConfirmedPremium.householdExpenseSource` plus `AftertaxPremiumInput.runContext`
opts into household funding. The generated stream carries references only and
uses the legal Person payer as owner. VS2 and the canonical writer reread both
publishers before retaining recognition and around payment; cold replay must
install those same independent publishers.

Acceptance fixtures exercise independent/combined routes with distinct members,
exact cents, subsidy exclusion, unpaid claims, owner/member/account/permission
rejections, revocation/cutoff/source changes, rollback, duplicate/idempotent card
transactions, duplicate payroll premium observation, legacy card v1 receipts,
independent cold-process portable replay and 1/12/24 premium proof growth.
Historical aftertax Person streams remain covered by the existing
`test/d2/integrated/aftertaxPremiums` suite.

CI, independent exact-head semantic review and PM merge approval remain required.
