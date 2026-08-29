# Architecture Decision Records

This directory records significant software-architecture decisions for the
Personal Finance App. ADRs explain implementation choices; they do not redefine
the financial semantics governed by the canonical and executable
specifications.

No decision record is accepted as part of the architecture/governance baseline.
ADRs will be introduced incrementally when implementation requires a durable
decision.

## Naming and lifecycle

- Name records `ADR-NNN-short-title.md` using the next unused three-digit number.
- Use one of: `Proposed`, `Accepted`, `Superseded`, or `Deprecated`.
- Never rewrite an accepted decision to change its meaning. Add a superseding
  ADR and link the two records.
- Link relevant specifications, issues, and pull requests.

## Planned topics

The system architecture identifies the following foundation topics: authority
hierarchy, modular-monolith boundaries, TypeScript engine choice, exact decimal
values and units, temporal boundaries, deterministic simulation, accounting
ownership, identity/idempotency, funding constraints, calculation lineage,
portable model versioning, future PostgreSQL persistence, scenario overlays,
AI boundaries, and separation of user identity from economic ownership.

These topics are a roadmap, not accepted decisions in this directory.

## Template

```markdown
# ADR-NNN: Short decision title

- Status: Proposed
- Date: YYYY-MM-DD

## Context

Describe the problem, constraints, and governing specifications.

## Decision

State the chosen architecture and its boundaries.

## Consequences

Describe benefits, costs, risks, and follow-up work.

## References

- Link to relevant specifications, issues, and pull requests.
```
