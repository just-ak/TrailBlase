# Toolchain

## Policy: best in class, verified

Prefer the current stable major of every dependency. "Current" means the
published `latest` tag, not what happens to be in anyone's memory.

Two hard rules qualify that preference:

1. **Newest is not best if it breaks the toolchain.** Before adopting a major,
   check `peerDependencies` of everything that consumes it. A version that
   forces `--legacy-peer-deps`, strands the linter, or has no working native
   build is not best in class.
2. **Verify, do not assume.** Resolve the real version with
   `npm view <pkg> version` and prove the set composes with
   `npm install --dry-run` before writing it into `package.json`.

When a newer major has to be skipped, record why in `docs/adr/` and revisit it
rather than leaving it undocumented.

## Node.js

This project targets **Node.js 26 (LTS "Lithium")**, pinned in `.nvmrc` and in
`package.json` → `engines`.

- Run `nvm use` in the repo root before any npm/npx command. This shell
  auto-reverts to a Node 20 default on directory change, and npm 10 has a
  resolution bug (`Cannot read properties of null (reading 'edgesOut')`) that
  will bite on this dependency graph. If a command behaves oddly, check
  `node -v` first.
- Do not downgrade the pin to satisfy a package. If a package only supports an
  older line, say so and propose an alternative instead of moving the pin.
- CI and local development use the same major.

Host Node only drives build tooling and tests. The Electron main and renderer
processes run the Node bundled with Electron (24.22.2, modules ABI 150 for
Electron 45), so a native module compiled against the host ABI will not
necessarily load. `postinstall` runs `electron-builder install-app-deps` for
exactly this reason.

One correction to the usual advice: `better-sqlite3` 13 is **N-API** based, and
N-API is ABI-stable across Node and Electron, so it needs no Electron-specific
rebuild. Do not assume that of the next native dependency. Verify instead —
`npm run verify:native` runs a real SQLite round trip inside Electron, which is
the only check that can actually prove it. See ADR 0010.

Electron 45 ships no postinstall script and downloads its binary lazily on first
`require('electron')`. `postinstall` therefore runs `install-electron`
explicitly, so a clean install is deterministic rather than deferring a ~130 MB
download to an arbitrary later command.

## Package manager

npm, as shipped with Node 26 (npm 11). Commit `package-lock.json`.

npm 11 blocks lifecycle scripts by default. `electron` (binary download) and
`better-sqlite3` (native build) both need them. Approve explicitly and record
the approved set in `package.json`; never disable the gate wholesale.

## Verified version matrix

Resolved and dry-run installed together on Node 26.13.0 / npm 11.20.0 with no
peer conflicts. Treat this as the baseline; re-verify before changing any line.

| Role            | Package                         | Version               |
| --------------- | ------------------------------- | --------------------- |
| Runtime         | node                            | 26.13.0 (LTS Lithium) |
| Desktop shell   | electron                        | 45.2.3                |
| Electron build  | electron-vite                   | 6.0.0                 |
| Packaging       | electron-builder                | 26.18.0               |
| Native rebuild  | @electron/rebuild               | 4.2.1                 |
| Bundler         | vite                            | 8.3.6                 |
| React plugin    | @vitejs/plugin-react            | 6.2.1                 |
| UI              | react / react-dom               | 19.3.1                |
| Language        | typescript                      | 7.0.2                 |
| Styling         | tailwindcss + @tailwindcss/vite | 4.3.4                 |
| Mapping         | leaflet                         | 1.9.4                 |
| XML parsing     | fast-xml-parser                 | 5.12.0                |
| KMZ (zip)       | jszip                           | 3.10.2                |
| FIT             | fit-file-parser                 | 6.2.7                 |
| Database driver | better-sqlite3                  | 13.0.3                |
| ORM             | drizzle-orm                     | 0.45.4                |
| Migrations      | drizzle-kit                     | 0.31.11               |
| State           | zustand                         | 5.0.16                |
| Validation      | zod                             | 4.6.7                 |
| Unit tests      | vitest + @vitest/coverage-v8    | 5.1.0                 |
| E2E tests       | playwright                      | 1.65.0                |
| Lint            | oxlint                          | 1.91.0                |

### Linting: oxlint, not typescript-eslint

TypeScript 7 is the native-port compiler and is the current stable major.
`typescript-eslint` 8.72.1 still declares `typescript: >=4.8.4 <6.1.0`, so
type-aware ESLint cannot run on TS 7 at all.

Resolution: keep TypeScript 7 and lint with **oxlint**. Type safety comes from
`tsc --noEmit` in CI, which is the stronger check anyway. Do not add
`typescript-eslint` while this conflict stands, and do not pin back to
TypeScript 5.9.3 to accommodate it. See `docs/adr/0002-typescript-7-and-oxlint.md`.

### No React binding for Leaflet

`react-leaflet` is deliberately absent. It is licensed Hippocratic-2.1, which is
incompatible with the project's GPL-3.0 licence and is not OSI-approved open
source. Leaflet itself (BSD-2-Clause) is used directly through in-house hooks.
Do not reintroduce `react-leaflet` or add another binding without running the
licence check first. See ADR 0008.

### Tailwind 4

Tailwind 4 is configured through the `@tailwindcss/vite` plugin and CSS-first
`@theme` directives. There is no `tailwind.config.js` and no PostCSS pipeline.

### No GeoJSON intermediate for KML

`@tmcw/togeojson` was considered for KML and rejected. It converts to GeoJSON,
which flattens names, descriptions and `ExtendedData` that the import-fidelity
rule requires us to preserve or report. GPX, KML and TCX are all parsed directly
with `fast-xml-parser`, which keeps one parsing approach and full control over
what survives. It also avoids pulling in an XML DOM implementation, since
togeojson needs one under Node.

### SQLite driver

`better-sqlite3` + `drizzle-orm`, not Node's built-in `node:sqlite`. Drizzle has
a first-class better-sqlite3 driver and none for `node:sqlite`, and the Electron
bundled Node is not the host Node, so the built-in module's availability is not
ours to assume. Revisit when Drizzle ships a supported `node:sqlite` driver.
