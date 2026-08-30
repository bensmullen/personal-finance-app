# Personal Finance App

A deterministic personal-finance modeling and simulation engine with a small
browser-based validation UI. The repository is currently an engine prototype:
financial correctness, explicit semantics, and reproducible results come before
product breadth.

## Current milestone

Vertical Slice 1 models one synthetic household month from domain inputs through
compensation, tax recognition and settlement, a retirement transfer, living
expenses, balanced accounting transactions, state transition, and financial
statements.

The browser demo is intentionally fixed to January 2026. It lets you vary gross
compensation, tax rate, retirement contribution, and living expenses. Tax is
recognized and settled in the same month; retirement is an internal household
transfer rather than an expense.

The engine remains one npm package, but its implementation now has explicit
internal boundaries under `src/`: `values`, `time`, `identity`, `model`,
`rules`, `primitives`, `dependencies`, `semantics`, `funding`, `accounting`,
`state`, `valuation`, `statements`, `lineage`, and `simulation` (plus the
foundational `diagnostics` module).

Root files such as `src/kernel.ts`, `src/verticalSlice1.ts`, `src/values.ts`,
and `src/time.ts` are thin compatibility facades. They re-export the canonical
module implementations and hold no independent financial logic or runtime
authority. Internal implementation files import leaf modules directly where a
barrel could create a cycle. The existing browser entry remains a consumer of
the Vertical Slice public facade. Root compatibility facades are external and
legacy surfaces; engine implementation modules may not use them as dependency
shortcuts.

The `primitives` directory establishes ownership only. The P01–P34 executable
registry remains Roadmap PR 6 work, and generalized multi-period simulation
remains Roadmap PR 7 work. This repository intentionally does not use npm
workspaces or `packages/*` yet.

## Requirements and setup

- Node.js 22
- npm, using the committed lockfile

Install and verify from a clean checkout:

```sh
npm ci
npm run spec:validate
npm run architecture:validate
npm run typecheck
npm test
npm run build:web
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
