# D2-D stage C: retirement and separately sourced Medicare BANK

Synthetic fixtures only. No real account, financial, tax, or CMS records.

`settlement.test.ts` exercises the product adapters, unchanged native state
writer and unchanged VS2 execution stream. Retirement transfers 500.00 from a
Person's 1000.00 pretax IRA to the household BANK. Medicare independently
recognizes and settles 80.00 Part B plus 120.00 Part D for another member.
The combined 400.00 opening BANK therefore finishes at 700.00, with 500.00
remaining in the IRA and 1200.00 consolidated net worth.

Both plain and RMD-referenced retirement routes retain native v2 posted proof;
RMD rows remain structural evidence and neither path applies satisfaction.
Nonzero withholding fails closed. Existing Person-owned retirement and Medicare
routes retain their prior journals and receipt behavior.

The independent composition-root providers reconstruct original source facts,
membership/directional permissions and legal journals without receiving caller
amounts or journals. Tests cover amended/withdrawn sources, authentic cutoff,
owner/payer/beneficiary bindings, source races, duplicate claims, same-date cash
contention, SSA exclusivity and rollback. Unfunded Medicare keeps full expense
recognition and unpaid obligations without settlement proof.

Portable replay is restored both in-process and in a fresh process through
`portableWorker.ts`; providers are reconstructed independently of artifact bytes.
The 1/12/24-month Medicare case checks exact balances, linear proof size, bounded
provider reads and absence of original catalogs in posted proof.

Verification belongs to GitHub Actions. During implementation the optional
bounded helper failed before typecheck/tests because its `.codex/logs` directory
could not be created under the desktop sandbox. No passing local verification
is claimed. Reviewer exact-head CI, semantic/portability audit and PM merge
approval remain required.
