# Opt-in FSA paid expense and BANK reimbursement (#202)

The composition root imports this subtree, registers one independent
`FsaCashSourceProvider` per process, and calls `attachFsaCash(kernel, input)`.
The provider returns full raw employer-plan/receipt/history facts, a separately
approved actual medical payment, and a separately confirmed actual BANK deposit.
It never receives the caller's settlement receipt. Registration is not replaceable.
There is no default provider or built-in statutory plan.

`FsaCashInput` contains source lookup IDs and full-content change-detection
fingerprints. Those fingerprints do not authenticate publishers. The provider
must establish the trust boundary outside the artifact. Every source evidence
record requires independently supplied exact `publishedAt`/`knownAt` instants;
civil dates and publication text alone fail closed with typed S7 incompleteness.
The shared receipt source version also binds the entire source snapshot so that
restoring an existing receipt detects amendments even without a version bump.

Original payment and later reimbursement are distinct scheduled events. The
original is funded on its actual payment date using the canonical accounting
writer and a typed original posting registration. A later deposit cannot fund it.
Reimbursement requires the exact matching original canonical archive, unchanged
`evaluateFsa` full-history evaluation, independently confirmed posted BANK cash,
and the shared `applyD2SettlementAtomically` writer. Documentary `settled` alone
does not prove cash. Legacy IDs without an archive cannot requalify originals.

This first adapter admits fully paid, fully eligible original medical expenses
and either full or partial source-approved reimbursement. The latter consumes
only its approved allocation and reports `entitlement_installment_port_required`
with the unreimbursed amount. Shared claim/proof/receipt consumption prevents a
second installment; it needs a separately authorized allocation port. Unsupported
opening carryover remains incomplete. Optional year-chain inputs are delegated
to `bindFsaYearChain`; applied carryover remains zero.

Full uniform coverage can reimburse before any employee payroll contribution.
No unrestricted FSA asset, entitlement journal, payroll credit, earned income,
wage-base change, tax saving or medical deduction is invented. The deposit credits
the original expense. Payroll/tax output remains explicitly incomplete.

Both events declare the owned BANK resource. Same-instant shared BANK use needs
an actual source-authenticated common sequence and distinct positions; unrelated
participant work at that instant fails closed. Dependencies never come from
input/registration order. The household kernel owns period candidates and rolls
back archive, receipts, identities and cash together on failure.

The portable codec stores source references, re-reads independent raw sources,
and rejects missing or amended facts on restore. The canonical v3 codec owns
posting/receipt history. A new process must import this adapter and register the
independent provider before restoring. No shared state, scheduler or replay file
is changed by this adapter.

Synthetic CI cases live under `test/d2/integrated/fsaCash/`. They cover the
$1500 → $500 → $1500/$1000 oracles, separate months, canonical originals,
source timestamps/amendments, legacy history, illegal/repeated approvals,
member ordering, contention, rollback and 13/25-month portable restoration in a
fresh process. Local tests/builds/validators were not run; CI and independent
semantic audit remain required before merge.
