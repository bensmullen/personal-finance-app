# ADR-008: Identity and idempotency model

- Status: Accepted
- Date: 2026-08-29

## Context

Persistent domain identity, deterministic generated occurrences, and imported
fact idempotency solve different duplication problems and must not be
conflated.

## Decision

Persistent domain IDs are typed UUIDs. Generated occurrence keys are derived
from ordered, length-prefixed stable identity parts: scenario, primitive
instance, scheduled instant, semantic effect type, and economic target. Import
idempotency keys use the same collision-resistant length-prefix encoding over
source type and source identity.

Keys include an encoding version. They do not depend on object-property order,
locale, randomness, or process-specific hashing. Canonical vectors lock their
observable form.

PR 2 introduces the identity constructors and key derivation foundation. The
authoritative state and occurrence registries that consume them remain in the
later state/run milestone.

## Consequences

- Equivalent inputs produce byte-for-byte equivalent keys across retries.
- Length prefixes prevent delimiter ambiguity in component values.
- Changing the key representation requires a new encoding version and a
  compatibility decision.

## References

- `docs/architecture/system-software-architecture.md`, Sections 11, 16.4,
  52.7, and PR 2
- `docs/personal_finance_executable_financial_semantics_v0.1.md`
