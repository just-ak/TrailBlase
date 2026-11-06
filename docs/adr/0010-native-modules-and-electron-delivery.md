# ADR 0010: Native module ABI and Electron binary delivery

Status: accepted
Date: 2026-11-06

## Context

The Phase 1 design listed two risks as the most likely to block everything:
the `better-sqlite3` native build against the Electron 45 ABI, and npm 11's
lifecycle-script gate preventing `electron` and `better-sqlite3` from
installing properly. Tasks 1 and 2 were ordered first specifically to find out.

Both turned out to be wrong, in different directions, and the real failure was
somewhere else entirely.

## Findings

**1. `better-sqlite3` 13 needs no Electron rebuild.** It is N-API based
(`node-addon-api` 8, `gypfile: false`, prebuilt binaries shipped flat under
`prebuilds/`). N-API is ABI-stable across Node and Electron, so the same binary
loads in both. Verified under the real Electron runtime by
`scripts/verify-native.mjs`, which reports Electron 45.2.3, bundled Node
24.22.2, modules ABI 150, and a working SQLite 3.53.4 round trip including the
WAL and foreign-key pragmas.

The design's premise — that native modules must be compiled for the Electron
ABI — is still true in general, and `electron-builder install-app-deps` is kept
in `postinstall` for whatever native dependency arrives next. It is simply not
load-bearing for this one.

**2. Electron 45 has no postinstall script at all.** Its published manifest has
no `scripts` field. The binary is downloaded lazily on the first
`require('electron')`, and it also exposes an `install-electron` bin. So npm
11's script gate never blocked it — there was nothing to block.

This produced a confusing symptom: `node_modules/electron/dist` was absent
after a clean install, while `npm install-scripts ls` listed only `esbuild` and
`electron-winstaller`. The lazy download then happens at an arbitrary later
moment, which is unacceptable for a reproducible install and for CI.

**3. npm 11's gate did matter, but only for approving the right set.**
`allowScripts` entries are pinned per `name@version`:

```json
"allowScripts": {
  "electron@45.2.3": true,
  "better-sqlite3@13.0.3": true,
  "esbuild@0.28.2": true,
  "electron-winstaller": false
}
```

## Decisions

- `postinstall` runs `install-electron && electron-builder install-app-deps`.
  The explicit `install-electron` makes the binary download a deterministic part
  of install rather than a surprise during a later command.
- `npm run verify:native` is kept as a standing check, not a one-off. It runs
  under Electron, so it catches an ABI regression that host-Node tests cannot
  see by construction.
- `electron-winstaller` is explicitly denied: it is a Windows-only helper and
  this build does not target Windows yet.
- The lifecycle-script gate is never disabled wholesale. Approvals stay pinned
  and reviewed.

## The risk that actually bit

Neither of the above. The real Phase 1 blocker was a dev/production branch in
window creation: it chose `loadURL` versus `loadFile` from `app.isPackaged`
rather than from the shape of the target. An unpackaged run with no dev server
has a *file path* while `isPackaged` is false, so `loadURL` was handed a bare
filesystem path. The renderer silently never loaded, `ready-to-show` never
fired, and the window stayed invisible with no error anywhere — which also made
the end-to-end tests unable to attach to any page.

Two changes came out of it, both kept:

- The branch is decided by the target (`/^https?:\/\//`), not by `isPackaged`.
- A failed `loadURL`/`loadFile` now logs and shows the window, and the main
  process installs `unhandledRejection` and `uncaughtException` handlers that
  surface a dialog. A startup failure must never again present as a hang.

A related ordering bug surfaced at the same time: `app.setPath('userData', …)`
ran after `app.requestSingleInstanceLock()`. The lock is scoped to the user data
directory, so every instance was locking the *default* directory regardless of
its configured data path — two app instances with separate databases still
fought over one lock, and Chromium logged cache-directory failures. The override
now runs before the lock, at module load.

## Consequences

The install is reproducible and the native path is proven under Electron rather
than assumed. The design's risk table was useful even though two of its top
entries were mistaken: ordering those tasks first is what surfaced the real
problem early, while there was nothing built on top of it.
