# Isolated health-FSA entitlement (#148 C3)

`evaluateFsa` is a pure person/employer/plan-year calculator under PFA-DET
§5.10/§5.11, PFA-INS-013 and PFA-TAX-015. Its private types preserve the logical
`d2-shared/v1` boundary. #149 owns the physical adapter, entitlement postings,
employer/payroll/benefits characterization and one-time bank reimbursement;
#101 owns actual withholding and wage-tax bases. No shared engine is called.

Supply an explicit half-open plan year (including noncalendar years), employee,
household, employer, plan and covered-member identities, salary-reduction
election and distinct employer addition. Sources identify subject, rule family,
publication, jurisdiction, effective period, version, as-of and explicit
verification freshness. The plan source admits its limits, allocation policy,
full-year employee/employer uniform availability, enrollment, termination and
exclusive year-end terms. Separate legal evidence supplies this exact plan
year's limits. There is no built-in legal catalog or assumed tax savings.
Unknown or restricted employer availability requires another supported contract;
this bounded API cannot infer availability from payroll funding.

All money is exact nonnegative USD fitting two minor-unit places. No rounding,
floating-point money or current-year rule substitution occurs. Payroll records
distinguish pending from posted employee/employer contributions and retain source
accounts, posting references and evidence. Contributions do not cap uniformly
available coverage: a verified $1,000 election with $100 withheld admits a
qualified $200 claim and leaves $800 restricted entitlement.

Receipts identify substantiated medical-service proof, receipt, member, provider,
incurred date/amount, submission date, separate paid/unpaid facts, dated sourced
qualification and named employee-owned reimbursement account. Full claim and
contribution history through the explicit evaluation date is mandatory, including
confirmation of cross-plan duplicate-benefit checks and zero omitted opening
usage. `priorCarryover: null` affirms no opening prior-year transfer under that
complete-history evidence. Missing/contradictory material facts suppress all
proposals and amounts for this affected employee/plan year. Unrelated employees
and years can be evaluated independently.

Proof aliases consume once; conflicting proofs fail closed. Denied receipts
consume zero. Historical approvals retain explicit prior/current lot allocations;
settled claims retain stable claim/operation/settlement identities with
`settlementRequired: false`. Pending proposals have not posted or reserved cash.
New contention follows the explicitly sourced
`prior_first_then_current/incurred_submitted_proof/v1` policy, after factual
historical approvals, independent of input order. Reversal, return and
cancellation remain typed unsupported; they cannot silently restore entitlement.

Carryover requires separately identified plan/legal caps and verified adjacent
same-owner re-enrollment or affirmative non-enrollment. Incoming carryover must
be a finalized S4 transfer with prior-year proof history, never this calculator's
uncommitted disposition. Prior/current restricted lots are traced separately.
Grace extends only admitted full-year coverage and has explicit incurred and
submission deadlines. Terminated coverage uses sourced cutoff/runout and the
explicit supported `forfeit_after_runout` rule; it cannot regain grace or roll
over implicitly. Disposition remains provisional until runout ends and all
approved claims are settled. Residual entitlement describes amounts before the
proposed disposition; `availableForNewClaims` is zero after submission closes.
No disposition posts cash, forfeiture or a rollover.

Outputs and evidence snapshots are copied/frozen. Restricted availability is
excluded from net worth. Entitlement and year-end coverage are separate from
payroll effects, reimbursement settlement and taxes, which remain incomplete
pending #149/#101 even when isolated calculations are supported.

Tests read the five unchanged FSA catalog cases and add explicitly artificial
plan/law/receipt evidence. Catalog capability remains `decision_required` and
integrated-runtime evidence remains false. Codex does not run local validation;
CI and an independent latest-head semantic audit own verification. Keep #148
open for retained C1/C2/C3 integration, plan-law catalog, D2 truth-table and UAT.
