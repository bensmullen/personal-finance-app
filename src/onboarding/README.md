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
duplicates/conflicts. Categories and historical occurrence identities remain
distinct. It neither merges nor filters candidates. Callers must retain stable
source/document/record identities across imports and consume review results.
There is no implicit content-derived institution identity. Changed metadata under
the same key requires review; review ordering is deterministic. These keys and
all candidate metadata are sensitive and must stay out of telemetry.

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
return `partial` with physical line locators and field/reason codes. A successful
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

## Bounded synthetic evidence

`test/o1OnboardingFoundation.test.ts` covers taxonomy, shape/provenance validation,
missing context, precision, identities, conflicts, deterministic comparisons,
supported/unsupported/partial import and telemetry rejection. The fixture is
entirely synthetic. GitHub CI owns execution; no local verification is performed
during this implementation task. PFA-ONB-002/007 foundations preserve missing and
material review items; UI prioritization/confirmation and PFA-ONB-011 dry-run
readiness gates remain integration/closeout work.
