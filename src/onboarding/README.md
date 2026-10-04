# O1 candidate/import foundation

This module proposes sensitive, typed candidates. It has no model write,
confirmation, persistence, provider or UI API. Canonical validation and reviewed
model/planning integration remain a later task after D1. Parsing never changes a
proposal's semantic category or claims it is confirmed authoritative input.

`validateCandidate` validates closed shapes and provenance compatibility. Missing
effective dates/transaction occurrence identities, supplied unresolved questions,
low/unknown confidence and approximate values remain visible for review. Money,
quantity and rate amounts are decimal strings; no financial arithmetic or rounding
occurs here. Precision qualifiers survive review. Currency codes are lexical ISO
style codes, not a claim of engine currency/product support.

`reviewCandidate` compares against caller-supplied candidate history. It reports
exact re-import, reused identity with changed content, and possible cross-source
duplicates/conflicts. Categories remain distinct. Within the same source type/ID,
distinct historical occurrence IDs remain distinct; across source namespaces,
matching historical category/subject/concept/effective date triggers a bounded
potential-overlap check even if external occurrence IDs differ. Value/precision
equality reports a potential duplicate, and differing values report a potential
conflict. Missing dates do not establish this cross-source overlap. No fuzzy
matching or reconciliation is performed. It neither merges nor filters candidates.
Callers must retain stable
source/document/record identities across imports and consume review results.
There is no implicit content-derived institution identity. Changed metadata under
the same key requires review; review ordering is deterministic. These keys and
all candidate metadata are sensitive and must stay out of telemetry.

Opaque identifiers (including source/document/record, target subject/concept and
occurrence IDs) preserve their bytes and reject surrounding whitespace. The public
key helper uses the same schema as validation and rejects malformed identities;
it cannot derive an alternate raw identity from rejected whitespace. Human text
and approximate qualifiers may still normalize display whitespace.

## Deliberately supported format

The sole adapter is an engineering-only synthetic CSV, not a bank statement or
production institution parser. Its first record is
`#pfm-onboarding-synthetic-v1`; its second record is exactly:

```csv
record_id,category,subject,concept,value_kind,value,currency,cadence,precision,qualifier,effective_date,occurrence_id
```

Supported category/concept/value-kind combinations:

| Category | Concept | Value kind |
| --- | --- | --- |
| current_fact | balance | money |
| historical_activity | transaction | money |
| goal | goal | text |
| constraint | constraint | text |
| assumption | spending | money |
| decision_policy | policy | text |
| planned_event | event | date |
| scenario | scenario | text |

Money requires explicit currency and cadence (`one_time`, `monthly`, `annual`);
balance snapshots and historical transactions require `one_time`.
Dates use valid `YYYY-MM-DD` dates. Precision is `exact` or `approximate`; the latter
requires a qualifier. Other unused material cells must be empty. Current facts
need an effective date; historical activity also needs an occurrence identity.
Missing required semantic context yields an unresolved proposal, not a guess.

The adapter accepts LF/CRLF, an initial BOM, quoted cells, escaped double quotes
and quoted newlines. Blank interior rows are reported as omitted invalid rows.
Input is bounded to 65,536 UTF-16 code units and 200 data records. Structural
malformation/limit failures return no candidates. Unsupported versions/headers
are explicit. Recognizable files with omitted, unresolved or overlapping records
return `partial` with physical line locators and field/reason codes. Exact repeats
remain visible as `exact_reimport` reviews without a material overlap issue; an
otherwise clean repeat returns `success`. Reused identities with changed content
or metadata still require review and return `partial`. A successful
import only means candidate extraction succeeded; it never means model readiness
or an authoritative commit. CSV planning rows are document observations of
planning proposals, not current financial observations.

## Privacy-safe measurement seam

`validateOnboardingTelemetry` accepts only closed stage/outcome/format labels and
nonnegative safe integer durations/counts. It rejects extra keys at every level;
its rejection result never echoes payloads or validation details. No filename,
identity, free text, raw value, document, transcript or candidate is accepted.
The contracts support progress/completion/abandonment, manual steps, corrections,
rejections, source/category mix, import outcomes and unresolved high-impact item
counts. They do not persist/transmit events, set readiness targets or assert that
a useful forecast exists. Later integration owns those measurements and dry runs.

Import outcomes include a closed reason shared by extraction and telemetry:

| Status | Format | Reason | Count constraints |
| --- | --- | --- | --- |
| success | synthetic v1 | none | At least one candidate; zero omissions/unresolved items |
| partial | synthetic v1 | material_issues | At least one candidate or omitted row |
| unsupported | unsupported | unsupported_format, unsupported_version, limit_exceeded | Zero candidates/omissions/unresolved items |
| unsupported | synthetic v1 | unsupported_header | Zero candidates/omissions/unresolved items |
| invalid | synthetic v1 | limit_exceeded, invalid_source_identity, malformed_csv, empty_import | Zero candidates/omissions/unresolved items |

`material_issues` also includes conflicting candidate overlap, which can require
review without omissions or unresolved missing inputs. Limits can be rejected
before format recognition (character bound) or after recognition (record bound).
These closed reasons contain no raw headers, identifiers or provider/file labels.

## Bounded synthetic evidence

`test/o1OnboardingFoundation.test.ts` covers taxonomy, shape/provenance validation,
missing context, precision, identities, conflicts, deterministic comparisons,
supported/unsupported/partial import and telemetry rejection. The fixture is
entirely synthetic. GitHub CI owns execution; no local verification is performed
during this implementation task. PFA-ONB-002/007 foundations preserve missing and
material review items; UI prioritization/confirmation and PFA-ONB-011 dry-run
readiness gates remain integration/closeout work.
