# C1 calibration boundary

`createCalibrationSet` accepts a provider-neutral draft, validates and copies it,
then returns a recursively frozen `calibration/v1` snapshot. `baseline.ts` exports
one maintained synthetic engineering vintage. Its invented moments are neither
investment forecasts nor recommendations.

Member keys are `kind:id`, with case-sensitive explicit internal definitions.
Asset classes, sectors, factors and issuers are separate namespaces; no fallback,
alias resolution, issuer inference, or provider averaging occurs. Future adapters
must supply versioned mapping and methodology identities and permitted provenance.
Blends and unknown fields fail until a contract explicitly supports them.

Terms cover `[0, horizon.months)` exactly. Expected returns are annual arithmetic
simple total-return ratios; volatility is the annual standard deviation of the
same return. Decimal strings use exact base-10 normalization, without rounding.
The single Pearson matrix applies across the horizon, names every member once,
and must be symmetric with a unit diagonal and exactly positive semidefinite.
Singular matrices are allowed. These are distribution **inputs**; a consuming
stochastic model must separately declare its distribution family, sampling and
time conversion. C1 does not imply a Gaussian or lognormal process from moments.

The normalized payload (including schema, source vintage, definitions, metadata,
provenance, mapping and methodology versions) determines the content identity.
Object keys sort, members sort by key, terms sort by start and adjacent equal
moments merge, and matrix rows and
columns follow normalized member order. Fingerprints follow the existing sorted
canonical JSON / UTF-8 FNV-1a 64 convention with a calibration domain prefix. The
JSON subset is implemented here to keep dependencies inward to values/time.
It is a change/reproduction fingerprint, not a tamper-resistance hash. The registry
compares canonical content as well as hashes and fails explicitly on collisions.

`observedAt` describes source observation/availability, not local fetch time.
Only fixed-vintage freshness is supported: consumers must explicitly select a
new source vintage; no current clock, acquisition/run ID or automatic refreshing
enters snapshot construction. Unsupported local/runtime fields fail rather than
become accidental economic inputs.

Serialized snapshots may be supplied back to the constructor or registry. Their
schema, ID and fingerprint must match recomputed content; stale or forged identity
fields fail. Derived identity fields are excluded from their own hash.

`CalibrationSnapshotRegistry.intern` deduplicates identical normalized content
within an explicitly owned registry. Forecasts can retain `calibrationReference`
and resolve it without copying calibration payloads. New content yields a new
identity and never replaces an old entry. Keep the registry available for every
retained reference. Persistence, bounded retention, and actual forecast integration
are later consumer work; this boundary neither evicts entries nor changes runs.

Bounded tests in `test/c1CalibrationContract.test.ts` cover C1's portion of
PFA-CAL-001–009: neutrality, provenance, moments/dependence, explicit definitions,
blend rejection, broad baseline specificity, fixed versioning, immutable content
identity, reference reuse and validation. Acquisition/adapters (R8), stochastic
execution (R5+) and persistent retention are outside this module. GitHub CI owns
verification; no local implementation-turn checks are run.
