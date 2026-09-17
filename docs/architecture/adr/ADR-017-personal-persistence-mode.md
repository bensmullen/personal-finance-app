# ADR-017: Personal persistence mode

- Status: Accepted
- Date: 2026-09-17

## Context

The Personal MVP needs durable storage for one local canonical model without
making persistence part of the financial engine or creating a second portable
model format. The application must remain usable as a public synthetic demo,
while real personal data is stored only on a trusted local or dedicated origin.

## Decision

The Personal MVP uses native IndexedDB, without a wrapper or new dependency,
as its single-model convenience store. The stored payload is exactly the
deterministic portable-model JSON string produced by the PR-13 portability
authority. IndexedDB structured cloning is not another domain serialization
format. Application use cases own save, load, compatibility, migration,
replacement, backup, and deletion policy; the browser adapter only reads,
atomically replaces, or removes the opaque string.

Persistence is manual and explicit. The user explicitly saves and loads. There
is no autosave, automatic load, or independent editor write. Edits remain in
memory until Save is used, and portable export remains the recommended backup.

Persistence is enabled for HTTPS origins whose hostname does not end in
`.github.io`, and for HTTP or HTTPS loopback development on `localhost`,
`127.0.0.1`, `::1`, or `[::1]`. It is disabled on `*.github.io` and insecure
non-loopback HTTP. A disabled origin never opens IndexedDB: the application
continues with in-memory editing and import/export and identifies itself as a
public/demo origin where users must not enter real personal financial data.

The existing portability functions and compatibility classifications remain
authoritative. Save serializes only with `exportPersonalModelJson`; load first
validates and then imports through the existing functions. Migration is an
explicit action using the existing registry. It validates and imports the
migrated result before one atomic replacement. Incompatible, legacy, invalid,
or migration-pending bytes are never silently overwritten or deleted and
remain available as an exact-byte backup.

Only the portable canonical model is persisted. Session settings, liability
execution profiles, investment execution-owner selection, forecast scope,
forecasts, comparison results, run errors, navigation, compiler output, and
simulation state remain non-persistent.

## Threat and recovery model

IndexedDB is not encrypted at rest by this application. A script executing
under the same permitted origin, or a person with access to the browser profile
or device, can potentially access the data. Browser-local storage can be
cleared and is not the sole backup. Portable export is the recovery mechanism;
exported JSON is plaintext and must be stored securely by the user.

Financial data must not be sent to telemetry or network services or placed in
URLs, logs, CI output, screenshots, or static assets. The default public GitHub
Pages origin is intentionally rejected for personal persistence. Encrypted
browser/file persistence is deferred because safe key, passphrase, and recovery
lifecycles require a separate security design; this ADR does not invent custom
cryptography. Server persistence is deferred because it belongs with private
alpha authentication, authorization, backup, and server/database architecture.

## Alternatives

1. **IndexedDB/browser-local structured persistence — chosen.** It supports an
   atomic single-slot store on permitted origins while retaining the portable
   serialized string as the only persistence representation.
2. **Local file as primary persistence — rejected as primary.** Repetitive file
   operations make browser editing cumbersome. Files remain the portable
   export, recovery, and backup mechanism.
3. **Encrypted local file or storage — deferred.** Safe key/passphrase lifecycle
   and recovery are a separate security design problem.
4. **Server persistence — deferred to private alpha.** It would prematurely
   require authentication, authorization, server, database, backup, and
   security infrastructure.

## Consequences

- Successful writes use IndexedDB transaction atomicity; failed writes retain
  the previously committed value without an ad-hoc second backup record.
- Reloading before Save can lose edits by design. Reloading after Save still
  requires the user to choose Load.
- Public/demo deployments retain all in-memory and portable-file workflows but
  do not offer local personal-data persistence.

## References

- [ADR-011: Portable model versioning and compatibility](ADR-011-portable-model-versioning-and-compatibility.md)
- [System and Software Architecture](../system-software-architecture.md)
