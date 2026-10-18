# Independent actual-runtime evidence for #149

These tests exercise `runHouseholdKernel`, actual accounting/state identities,
summary/detail statements, portable artifacts and the existing sparse checkpoint
cadence. All source terms, identities and amounts are synthetic.

Authored oracles:

- $2,000 opening bank / $0 principal + $500 authorized draw = $2,500 bank,
  $500 liability, $2,000 net worth, $0 income/expense/gain and $500 financing cash.
- Add the existing admitted C1 $300 premium on a later day = $2,200 bank,
  $500 liability and $1,700 net worth. Only the premium recognizes expense and
  creates/settles a claim.
- Two explicitly sequenced $500 draws reach the $1,000 cap without recognizing
  income. A stale second draw rolls back the first as well.

Coverage remains incomplete despite committed draw periods. Positive quoted B1
interest never becomes a cash payment, recognition or claim in this slice.
Thirteen quiet periods are the minimum needed to exercise the kernel's existing
twelve-month sparse checkpoint continuation, rather than opening-only replay.
The tests retain the conditional `heloc_draw`/`heloc_reset` prep statuses and do
not claim catalog promotion or full HELOC/household acceptance.

GitHub Actions owns verification. No local tests, typecheck, builds, browser runs
or package installation were performed in the Codex implementation turn.
