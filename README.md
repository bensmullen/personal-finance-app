# Personal Finance App

A deterministic personal-finance modeling and simulation engine with a typed,
static Next.js Personal-MVP application. Financial correctness, explicit
semantics, and reproducible results come before product breadth.

## Current milestone

The browser application is organized around Overview, Money, Net Worth, Plan,
and Settings. It provides guided setup, friendly editing of the ten canonical
Personal-MVP object areas, PR 13 portability, scope-specific forecasts, and
deterministic comparison surfaces with accessible chart tables. Changes are
session-only; export the portable model to preserve them. Independent simulation
slices are never presented as a reconciled household forecast.

The engine remains one npm package, but its implementation now has explicit
internal boundaries under `src/`: `values`, `time`, `identity`, `model`,
`rules`, `primitives`, `dependencies`, `semantics`, `funding`, `accounting`,
`state`, `valuation`, `statements`, `lineage`, and `simulation` (plus the
foundational `diagnostics` module).

Root files such as `src/kernel.ts`, `src/verticalSlice1.ts`, `src/values.ts`,
and `src/time.ts` are thin compatibility facades. They re-export the canonical
module implementations and hold no independent financial logic or runtime
authority. Internal implementation files import leaf modules directly where a
barrel could create a cycle. The React UI consumes only the Personal-MVP
application facade. Root compatibility facades are external and
legacy surfaces; engine implementation modules may not use them as dependency
shortcuts.

The `primitives` module now contains one immutable runtime catalog for all
canonical P01–P34 identities and common typed evaluation contracts. P01, P02,
P03, P04, P05, P06, P08, P13, P20, P22, P23, P24, P26, P27, P29, and P30 are executable; the other 18 identities
are deliberately registered-only and fail explicitly if evaluation is
requested. Primitive evaluation returns values, occurrences/effects, explicit
next primitive state, diagnostics, and lineage references without posting
accounting or mutating authoritative financial state. Generalized multi-period
orchestration and primitive-state commit are provided by the simulation runtime. This
repository intentionally does not use npm workspaces or `packages/*` yet.

## Requirements and setup

- Node.js 22
- npm, using the committed lockfile

Install and verify from a clean checkout:

```sh
npm ci
npm run spec:validate
npm run architecture:validate
npm run editor:check
npm run typecheck
npm test
npm run build:web
npm run test:e2e
```

The web build is written to `dist/`. To inspect it locally, serve that directory
with any static HTTP server, for example:

```sh
python3 -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

## Sources of truth

Financial and implementation authority is ordered as follows:

1. [Canonical financial specification](docs/personal_finance_canonical_schema_v1.0.json)
2. [Executable financial semantics](docs/personal_finance_executable_financial_semantics_v0.1.md)
3. [Vertical-slice specifications](docs/vertical-slice-1-specification.md)
4. [Architecture Decision Records](docs/architecture/adr/README.md)
5. Executable implementation
6. Generated artifacts

The [system/software architecture](docs/architecture/system-software-architecture.md)
governs repository structure, engineering standards, data boundaries, and the
implementation roadmap. [AGENTS.md](AGENTS.md) summarizes the rules that apply
to agent-assisted changes.

The compatibility baseline is recorded in
[`docs/spec-manifest.json`](docs/spec-manifest.json) and checked by
`npm run spec:validate`. Module direction, facade shape, browser isolation, and
runtime import acyclicity are checked by `npm run architecture:validate`.

## Generated artifacts

The model JSON Schema, generated TypeScript interfaces, and PostgreSQL DDL are
design/reference artifacts until they are formally reconciled with the
canonical specification. They are not independent sources of financial truth.
Known incompatibilities, including number-based generated money and rate
mappings, are declared in the specification manifest.

## Data safety

The repository and public demo use synthetic data only. Never commit real
personal financial information, secrets, account identifiers, screenshots, or
logs containing financial content.

