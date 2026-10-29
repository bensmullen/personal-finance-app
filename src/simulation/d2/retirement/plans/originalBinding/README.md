# A2 original contribution qualification

`bindPlanContributionOriginals` is a source-only conditional adapter around the
unchanged `evaluatePlanContributions`. Authority: PFA-DET-017 §5.2/§5.11,
PFA-INV-025, PFA-TAX-015 and the D2 S1–S8 freeze. It neither posts payroll nor
increases accounts, consumes shared capacity, calculates tax or settles funds.
All outputs are `committed:false`, `postable:false`; funding, tax and settlement
remain incomplete. #149 owns physical integration and shared annual capacity.

The consumer supplies household/year, as-of/cutoff, a half-open display period,
operation IDs and four full-original SHA-256 pins. It cannot supply economic
terms, verified flags, prior-capacity objects or observed operation IDs. IDs and
exact amounts come from authenticated original books. The cutoff must equal
as-of; stale history is not carried forward. One tax year and at most 256 proposed
operations are admitted per batch. Originals must cover the actual operation
dates, independently of the display horizon.

Four distinct publisher identities supply complete, unfiltered household/year
books through cutoff:

- `plan`: sponsor/plan/family, participant enrollment, owned destination,
  participation and plan-permitted payer/bucket/compensation types.
- `funding`: complete signed payroll items or employer authorizations, their
  stable operation/claim/authorization/source identities, exact amounts, source
  accounts and person/employer-linked eligible compensation and contribution cap.
- `legal`: effective-dated person/year limits and exhaustive applicable scope
  identities, plus legal permission by member/plan/route. Plan and legal
  compensation permissions are intersected. No law constants are embedded.
- `history`: all relevant employers and 401(k), 403(b), TSP, governmental 457(b),
  SEP and SIMPLE coverage; itemized committed operations (including future-dated
  committed instructions); complete before-as-of scope usage or explicit
  authenticated zero declarations. Itemization must reconcile to the publisher's
  totals. Only the existing evaluator computes new contributions and headroom.

`OriginalPublisher` describes source retrieval. The separately injected
`OriginalProvider` is the trust boundary: its `authenticate` implementation must
authenticate the whole retrieved inventory, completeness assertion and signed
originals, using publisher authority established outside the consumer request.
A checksum, `signedBy` string, consumer-created boolean, or request-provided
provider is not institutional authentication. No production provider or
credentials are supplied. Tests use explicitly labeled synthetic publishers
and private inventory-seal registries; simulation evidence never attests actual
IRS law, payroll execution or an actual institution.

Each pin binds role/publisher/source/original/version and SHA-256 of the entire
canonical original, including household/year, identities, dated effectiveness,
known-at/publication and payload. Array ordering is part of the signed original.
The query never filters by pin, operation ID or display horizon. Multiple IDs,
revisions, withdrawals, role/identity conflicts, unqualified books, missing
history and future-known sources fail closed. Before returning, the adapter
re-reads and re-authenticates **all four** mandatory books, even after a failed
first read or evaluation. Full inventory witnesses must remain identical.
There are two reads/authentications per available role, independent of event
count. Missing roles do not prevent other roles from being requalified.

All selected operations form one coherent atomic batch, delegated once when
sources qualify. No request order chooses a capacity winner. Replay checks use
historical operation, claim and funding-reference identities across all plans,
including unused authorizations. Re-evaluating unchanged uncommitted evidence
is deterministic; it does not mark anything consumed. Unsupported catch-up,
rollover and other owner-gated routes cannot create funds or fallback capacity.

The result contains a frozen run-scoped reference registry, conditional exact
economics, owner capacity proposals, per-operation coverage and typed source
diagnostics. Event rows carry short reference IDs, never original payroll
documents, history books or rule tables. Full originals are used transiently for
qualification and their witnesses appear once in the registry. Conditional
capacity proposals retain the owner's person/year/scope/version keys.

Independently runnable tests in `test/d2/retirement/plans/originalBinding/`:
`binding.test.ts` covers five-family economics/order/replay and split people;
`qualification.test.ts` covers hostile originals, inventory/history gaps,
permission/funding and second-read changes; `payload.test.ts` supplies bounded
1/12/120-event exact-cent/read-count/reference/payload evidence. These are
conditional synthetic cases, not integrated or UAT evidence. Existing owner
tests and all integration/compiler/payroll/state/tax code remain read-only.
GitHub CI owns verification and independent latest-head audit remains required.
This phase does not close #146, D2 or authorize R5; PM alone merges.
