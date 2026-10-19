# Opt-in Medicare B/D BANK execution

`attachMedicareBank` accepts an existing compiled USD household cash kernel, an
explicit source cutoff, raw `MedicareCoordinationRequest`, and exact confirmations
of every positive obligation. It regenerates C1/C2 composition; neither a caller's
complete flag nor an unposted claim authorizes execution. Sources must be verified,
effective for the complete calendar month, and known by the occurrence and run
cutoff. Each request must fit its compiled horizon. Annual CMS snapshots and
lookback returns remain source-owned; submit separately sourced requests across
tax years. No rate, future law, SSA award or alternative account is inferred.

Each positive B/D confirmation binds an existing owned checking/savings BANK,
existing payable, member, payer, Part, provider, coverage, plan, quote, month and
explicit priority to distinct expense/primitive UUIDs. The amount is exact USD
member base plus that Part's monthly IRMAA once. Zero A is retained in composition
as coverage evidence and creates no stream, claim, expense or payment. Other
elected Parts remain unsupported, even when zero.

The immutable overlay installs one month-bounded `RecurringExpenseStream` per
positive Part. Run its returned kernel with `runHouseholdKernel`. The unchanged
VS2 engine owns recognition, claims, all-or-none named-account funding, settlement,
transactions and replay identities. BANK funding never creates income or a tax
withholding credit. Unfunded Parts leave real unpaid claims and shortfalls;
distinct authored priorities order competing B/D payments. An unrelated operation
on the same BANK/instant is rejected with `HOUSEHOLD_CONTENTION_UNRESOLVED`.
The adapter does not rewrite household cash priority to make it pass.

All overlapping generic expenses require source-linked representation evidence.
Only one exactly equivalent bounded premium can be replaced, after matching
ownership, trace, recurrence, amount, account, payable, priority and nonpartial
funding semantics. Distinct obligations retain their independent sources and
streams. Ordinary unrelated income remains intact. Existing same-member/Part/month
claims, SSA participants, ambiguous equivalents and changed bindings fail closed.
Reattachment of the exact original request returns the same kernel. Reattach the
original request grouping when it overlaps existing bindings; new disjoint months
or recipients may attach independently. Admission is atomic for the whole request.

A portable source guard requalifies raw sources against the execution cutoff,
checks the actual VS2 occurrence and amount, and reports tax characterization as
unsupported. It writes no ledger, receipt or custom replay format. Import this
opt-in module before restoring its existing `household-replay/v3` artifact through
the replay API so its participant codec is registered. Canonical VS2 claim,
transaction and settlement history remain the payment evidence; the complete
binding in trace retains separately inspectable Medicare/IRMAA identities.

`netCashCoverage` on attachment describes admission, not a paid claim or a complete
forecast. Projected taxes and medical deductibility remain incomplete in actual
summary/detail execution. This bounded integration does not close D2, change old
conditional fixtures, or promote #148's domain evidence. Later #149 shared-engine
performance work still owns the retained SSA full-history qualification follow-up.
