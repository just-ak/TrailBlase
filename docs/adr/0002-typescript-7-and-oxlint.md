# ADR 0002: TypeScript 7 with oxlint

Status: accepted
Date: 2026-11-05

## Context

The project targets current stable majors. TypeScript's `latest` tag is 7.0.2,
the native-port compiler. There is no 6.x release line; the version jumped from
5.9.3 to 7.0.

`typescript-eslint` 8.72.1 declares `peerDependencies.typescript` as
`>=4.8.4 <6.1.0`. Type-aware ESLint therefore cannot run on TypeScript 7 —
not merely with a warning, but unsatisfiable.

Options considered:

1. TypeScript 5.9.3 + typescript-eslint 8 — keeps typed lint rules, gives up
   the native compiler's build-time improvements and sits a major behind.
2. TypeScript 7 + typescript-eslint via `--legacy-peer-deps` — unsupported
   combination, silently broken type information in lint rules.
3. TypeScript 7 + oxlint — current compiler, fast Rust linter, no typed lint
   rules.

## Decision

Option 3. TypeScript 7.0.2 with oxlint 1.91.0.

`tsc --noEmit` runs in CI and in the pre-commit gate. This is a strictly
stronger correctness check than typed lint rules, which mostly approximate what
the compiler already proves under `strict`.

## Consequences

A handful of lint rules that need type information are unavailable, such as
no-floating-promises and no-misused-promises. Partial mitigation: `strict` plus
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` in tsconfig, and
oxlint's own type-free approximations where they exist.

Revisit when typescript-eslint widens its peer range to TypeScript 7. At that
point adding it back is additive and costs nothing already built.

Forbidden: pinning TypeScript back to 5.x to re-enable typescript-eslint
without re-opening this ADR.
