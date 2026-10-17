# D2-C C2 isolated IRMAA evaluation

`evaluateIrmaa` implements the bounded #148 phase under PFA-DET §5.9/5.11,
PFA-INS-013 and PFA-TAX-015. #149 owns the physical shared adapter, historical
tax linkage, combination with quoted base premiums and single SSA-or-bank
settlement. This domain emits only uncommitted monthly surcharge candidates.
It requires no Social Security award, payer or cash account.

The S2/source owner supplies verified CMS annual snapshots (`cms_irmaa`),
explicit legal lookback tax years, exact USD filing/marital-state tier partitions,
publication, as-of date, vintage/version and half-open effective windows.
There are no bundled CMS values, network requests, clock reads or tax estimates.
All money must fit exact USD cents; no rounding is performed. Tier endpoints
are explicit inclusive/exclusive amounts; null denotes an unbounded endpoint.
Tables must partition the entire MAGI axis without gaps or overlaps, including
negative MAGI. Table ordering never selects precedence.

Historical MAGI and filing/marital state come from a person/household-linked
return reference and verified `historical_tax_return` source whose effective
window covers that historical year. The source's publication/as-of may be later
than the year reported. The evaluator never assumes a two-year lookback or
reuses another year's table. Verified `irmaa_override` evidence must identify
a legally approved SSA/CMS determination, income reference/year, filing/marital
state, MAGI, annual rule snapshot and covered dates. A life event reference alone
does not qualify an override. The determination may supply approved current-year
income; the evaluator does not estimate it. A qualified override replaces normal
history only during its covered months. Unqualified or competing overrides block
the affected months rather than silently choosing a more favorable tier.

Person/Part enrollment (`medicare_enrollment`) includes elected plan identity,
compatible elections and effective boundaries. Duplicate person/Part/month
obligations are rejected even across different plan IDs. An optional read-only
C1 proposal reference must match person/household/coverage/plan and elections;
its quoted amounts and settlement route do not become IRMAA amounts.

This bounded API supports only explicitly sourced `whole_month_only` rules.
Partial request/enrollment months, mid-month determination changes, unknown
proration and death months remain incomplete. Coverage termination excludes
subsequent months. A verified `death_record` excludes months beginning on/after
the death boundary; the death month requires separate sourced proration if the
boundary falls inside the month. No refund is fabricated.

Results are copied/frozen, with stable person/Part/month operation identities,
rule and income source snapshots, tier interval and trace references. Each
missing material fact generates typed `medicare_total` and `net_cash`
incompleteness. `surchargeCoverage` describes only the isolated lookup; Medicare
totals and net cash remain incomplete even when surcharge candidates are known.
No cash debit, SSA deduction, premium recognition or tax calculation occurs.

Tests use separately qualified artificial evidence with tiny thresholds/rates;
none represents actual CMS law. The original `medicare_irmaa` catalog fixture
retains its 30,000-cent base quote, missing income/status/law,
`decision_required` capability and false integrated-evidence flag. C1 is
unchanged. C3, integration, household truth-table evidence and UAT remain open.
Codex does not execute local verification; CI and independent latest-head
semantic audit own verification and merge approval.
