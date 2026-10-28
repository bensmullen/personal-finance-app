# Conditional original-source Medicare IRMAA admission (#148)

`proposeOriginalIrmaa` consumes independent original CMS rules, original CMS/SSA
enrollment and eligibility, filed IRS historical returns, and, when applicable,
separate SSA/CMS granted determinations and legally eligible life-event evidence.
It delegates all tier partition, equality, filing-state, legal lookback, override
precedence, partial-month/death and exact surcharge arithmetic to unchanged
`evaluateIrmaa`. No CMS thresholds are bundled or invented. Sources and tests
are confined to new `originalBinding` subtrees, under PFA-DET-020 §5.9/§5.11,
PFA-INS-013 and PFA-TAX-015.

The parameterized `IrmaaOriginals` port deliberately has no default provider.
Each lookup must independently retrieve the entire applicable publication and
exhaustive publisher/revision inventory for the exact household, member, Part,
coverage, premium year, event and cutoff. Return lookup additionally takes the
unchanged rule's explicit legal income year. Providers must include competing
claims and superseded and future-known revisions, including their full original
content, rather than echoing a submitted proposal or filtering out inconvenient
conflicts. Determination lookup must positively establish completeness even
when there is no alternative determination. An unavailable inventory is not
evidence that none exists.

The provider is responsible for source authenticity, exhaustive discovery, and
mapping original legal content into typed values. The binding checks issuer,
source/version, immutable claim identity, publication/known-at chronology,
source as-of and effective dates. IRS filing authority is distinct from the
SSA/CMS legal grant authority. A hash, caller qualification string, user
attestation, projected rule, draft return or life-event reference alone does
not qualify a source. A granted override must link separate original evidence
for an event expressly allowed by that original CMS rule. Enrollment must carry
source-owned eligible dates and the same birth identity as the requested member;
this module does not invent age/disability eligibility law.

Only revisions known both at the economic event and at the data cutoff may
supersede earlier evidence. Supersession must explicitly reference an earlier
claim from the same issuer and source; competing applicable claims block the
event. Supersession does not infer precedence from array order or a later
publication. Sources must scope their inventory to publications and grants
applicable to the requested event, including partially applicable enrollment or
grant windows so the existing evaluator can diagnose unsupported proration.

After evaluation every mandatory inventory is independently read again,
including empty determination inventories and future-known amendments. Any
withdrawal, exception, revision, inventory change or changed original content
suppresses the event's candidate. SHA-256 commits the full original envelope
and full inventories, with unordered source sets normalized; it is content
addressing, not source authentication. Providers must return `undefined` for
withdrawal and changed originals for amendments. There is no asynchronous
atomic publication/settlement guarantee here: #149 must requalify sources when
admitting execution.

Each event is one member/Part/month. Duplicate member/Part/month events or
applicable enrollment claims across plans, publishers or original revisions
block all contenders. Independent members remain separate. Identities do not
depend on forecast horizon, provider ordering or coverage/plan renaming. Invalid
or unsupported events remain typed incomplete. Caller-provided death records
are passed to the unchanged solver for gating but cannot establish original
death evidence or financially complete non-applicability; affected events also
remain `DEATH_SOURCE_REQUIRED`. Original death admission remains outside this
bounded port.

Frozen results contain exact monthly surcharge, tier reference, premium/income
years, compact original pointers with full-content SHA-256 digests, and compact
inventory commitments. They contain no raw CMS table, return/MAGI, original
publication, annual source inventory, C1 base premium or SSA award. Source reads
and serialized evidence grow proportionally with event count; evidence is not
accumulated from preceding events. Tests exercise 1/12/120 events, fixed-cent
synthetic equality oracles, independently granted alternatives, source races,
late/future amendments, identity/filing/eligibility mismatches and mixed-member
isolation. All test law and amounts are deliberately synthetic.

Every candidate is conditional, `committed:false`, `postable:false`, with
`cashSettlement:incomplete` and `taxLiability:incomplete`. No BANK debit, net SSA
adjustment, tax credit, premium combination or settlement is emitted.
`composeMedicareObligations` is a read-only reference; C1 and #149 remain the
exclusive owners of their combination and execution work. This phase does not
close #148, D2 or unlock R5. Latest-head CI, independent financial/provenance
audit and product-manager approval remain merge gates.
