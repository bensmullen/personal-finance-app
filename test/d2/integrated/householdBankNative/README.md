# Native household BANK state contract (#285)

This fixture suite owns synthetic publishers only. No domain adapter, VS2 path,
provider connection or second accounting ledger is implemented here.

The opt-in is `NativeHouseholdPostingAttachment` (`native-household-posting/v1`):
an actual journal ID, native family, actual event/run/asOf/dataCutoff context,
legal actor and household BANK, compact independent economic original references,
and a BANK route pin. `cashRole: nonbank` is reserved for a card issuer original;
it has no route or cash leg. A zero-net SSA payment retains its independently
qualified credit permission without inventing a zero cash leg.

Native records select explicit versions:

| Native authority | Opt-in | Canonical writer entry |
| --- | --- | --- |
| `ssaMedicarePayments` | `ssa-medicare-payment/v3` plus `nativeHousehold` and original-source semantics | `applySsaMedicarePaymentAtomically` |
| `retirementDistributionAllocations` | `retirement-distribution/v2` plus `nativeHousehold` | `applyRetirementDistributionAtomically` |
| `d2SettlementReceipts` (FSA/card) | `d2-shared/settlement-receipt/v2` plus `nativeHousehold.original` and `.settlement` | `applyD2SettlementAtomically` |
| Earlier paid expense/issuer journal | Native attachment on the normal FSA/card registration | `applyNativeHouseholdOriginalAtomically` |

The earlier-original helper accepts the actual transaction, native registration
and real run boundaries. It does not require a future reimbursement/payment
approval or receipt. Original and settlement attachments may retain different
run boundaries, but each must authenticate its own actual dated journal. New
settlement admission binds its attachment to the supplied current run boundaries.
Use `d2SettlementPostingRegistration` to generate both receipt registrations.

Composition must independently install the existing native source authority,
`registerHouseholdBankRouteAuthority`, and family/publisher-scoped
`registerHouseholdEconomicOriginalAuthority`. FSA/card economic qualification
must additionally return `nativeSource`: the compact plan/year/member/payee/
medical-receipt/expense-payment identity or issuer/statement/charge/liability
identity. This prevents a valid issuer journal from authenticating a different
claimant or liability. Generic S1 publishers remain compatible without that
optional field. Retirement source accounts remain person-owned; the separate
destination check does not replace source-ledger checks or either cash leg.

All transitions stage the sole accounting writer and requalify before commit.
SSA proofs reference their native payment key; they do not copy the payment
source document or claims into a second archive. Legacy formats omit the new
fields and preserve historical journal/consumption normalization. No proof may
be backfilled onto an already posted transaction.

Cold import and checkpoint delta admission requalify native sources. Explicit
replay uses `requalifyD2SettlementReceiptHistory` and
`requalifyRetirementDistributionHistory`; a source fingerprint, archive checksum
or caller serialization cannot stand in for a registered source owner.

The tests cover native family journals/records, legacy round-trip bytes,
source/route forgery and withdrawal, pre/post-staging races, same-BANK member
reuse, cash contention, issuer/claimant bounds, isolated-process import/checkpoint
replay, and 1/12/24-event storage/provider-read bounds per family. Their synthetic
source authorities reconstruct from lookup IDs rather than submitted journals.
Production adapters and their independent financial audits remain with
#277–#280; this prerequisite does not close #149 or authorize RMD/tax credit.
