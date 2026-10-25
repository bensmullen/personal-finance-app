# Conditional original-source health-FSA payroll binding (#148)

`proposeFsaPayrollBindings` reconstructs unchanged `evaluateFsa` from one
independently fetched original owner/employer/plan-year request. There is no
caller-authored proposed contribution or entitlement to authenticate. Every
pending **and posted** history row must exactly match a separate original
contribution document, election, authorization and funding source. Complete
history remains the source provider's responsibility; omission cannot be proved
from an arbitrary caller's array. `historyEvidence` is mandatory, and providers
must not synthesize it from submitted proposals.

The domain-local `FsaPayrollOriginals` port requires independent original
request/plan/law publication windows, contribution records and versioned signed
wage journals. It intentionally has no default provider. Source withdrawal must
return `undefined`; amendments must return the changed original. Documents and
histories stay behind these callbacks. SHA-256 commitments detect content
changes, including signed journal amendments; they are not signatures, source
authentication or canonical `PayrollHealthSourceAuthority` registration.

Employee salary reductions require the exact original #101 income, paycheck
occurrence, journal, job, employer and existing employee-owned BANK. Each signed
asset debit must reconcile to the original 401(k)/HSA or jurisdiction/year paid
tax position, alongside gross income and net cash. Existing deductions plus the
proposed reduction must fit gross to the cent. No paycheck, wage, pay cadence,
withholding or jurisdictional exemption is calculated. An original containing
any FSA claim is rejected. Already allocated history is independently checked
and never proposed for posting again.

Employer grants require separately authorized employer funding and plan terms.
They have no paycheck reference and are neither wage cash nor household income.
Employee and employer totals remain subject to the unchanged evaluator's
distinct election/plan/legal limits. Publication, election, job and source
windows are checked at the original contribution Instant. The plan and legal
windows must identify the exact snapshots consumed by the evaluator. Missing
jurisdiction facts produce typed S7 tax incompleteness; there is no exclusion,
Section 125 qualification, tax savings or tax calculation here.

Duplicate contribution, claim, authorization, source document, grant, journal,
paycheck occurrence and posting identities fail the entire owner/year bundle.
An election cannot silently move between jobs/incomes. Medical proof, payment,
claim and reimbursement identities cannot be reused as payroll funding claims.
No order-dependent contender wins. Unchanged `evaluateFsa` owns full elected
availability, prior-year lots, claim allocation, paid settlements and year-end
terms. This binder creates no second entitlement register or medical expense.

Output includes only occurrence-specific amounts, identities, source version
pointers and fixed-size content digests. No source journal, rule catalog, plan,
receipt or annual history is copied per paycheck. Unordered source facts are
normalized before hashing; returned data is copied and frozen. Authored tests
cover 1/12/120 occurrences with a linear serialized-size bound, two independent
$100 paycheck reductions, a distinct $25 employer grant and negative source,
scope, funding, limit and reuse cases. Values and legal evidence are synthetic.

All bindings are `committed:false`, `postable:false`, with funding, payroll
effect, tax and entitlement settlement **incomplete**. Restricted FSA coverage
is excluded from net worth. The binder is not evidence of paid payroll, even
when the evaluator admits the full annual election before any payroll posts.

#149 must supply authenticated canonical sources, requalify current original
versions and complete actual salary reduction/employer funding, lawful wage
bases, durable entitlement/journal/replay and atomic settlement. Physical
carryover/forfeiture, year-end cash and owner UAT remain outside this phase.
GitHub CI and independent semantic audit own merge evidence; this contract does
not close #148 or grant merge approval.
