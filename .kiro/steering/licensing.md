# Licensing and distribution

The application is **GPL-3.0-or-later**. It is free to download and use, with no
subscriptions, no mandatory accounts, no advertising, no paid feature tiers and
no cloud dependency for core functionality. See ADR 0007.

These are policy, not preferences. Do not introduce a paywall, an account
requirement, a feature gate or ad delivery, and do not make core functionality
depend on a network service.

## Before adding any dependency

Check the licence first. Adding it and auditing later is how incompatible code
ends up shipped.

```sh
npm view <package> license
```

| Licence                                                                       | Verdict                                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| MIT, ISC, BSD-2/3-Clause, 0BSD, Apache-2.0, Unlicense, CC0, Blue Oak, MPL-2.0 | Fine                                                                         |
| GPL-2.0-**or-later**, GPL-3.0, LGPL-2.1+, LGPL-3.0, AGPL-3.0                  | Fine, now permitted                                                          |
| GPL-2.0-**only**                                                              | **Incompatible** with GPL-3.0. Reject.                                       |
| Hippocratic, ethical-source, or any licence with field-of-use restrictions    | **Reject.** Additional restrictions GPL-3.0 §7 forbids, and not open source. |
| `SEE LICENSE IN …`, `UNLICENSED`, bilateral EULAs                             | **Reject** unless the text is read and confirmed compatible. Assume not.     |
| No declared licence                                                           | **Reject.**                                                                  |

The distinction that catches people out: GPL-2.0-only cannot be combined with
GPL-3.0 code. "Or later" is what makes a GPL-2 era dependency usable here.

A build-only dependency that never reaches users does not bind the combined
work, so the bar is lower. It still has to permit contribution, and it still
goes in the register.

## The register

`docs/licences/third-party-register.md` must be regenerated whenever
dependencies change, and the change committed alongside. A register that lags
the lockfile is a compliance failure, not an inconvenience.

## Obligations on every release

- Publish the complete corresponding source for the whole combined work,
  including any bundled GPL components.
- Reproduce third-party notices in the About window, including Electron's and
  Chromium's.
- Keep `LICENSE` at the repository root unmodified.
- Carry per-file copyright and licence headers on source files.

## Distribution channels

GitHub releases plus a DMG for direct download. Notarisation is compatible with
GPL-3.0 — it attests to the binary rather than restricting the user — but there
is no Developer ID yet, so builds are **ad-hoc signed** and notarisation is
configured but disabled. See ADR 0009, and document the Gatekeeper consequence
honestly rather than hiding it.

**Not the Mac App Store.** Its terms impose usage and copy restrictions and a
DRM layer that conflict with GPL-3.0 §7 and §3. Do not propose it, and do not
add App Store targets to the build configuration.

## Garmin formats

Prioritise functionality and Garmin compatibility over licensing caution, within
the law. GPL tooling such as GPSBabel (GPL-2.0-or-later) is now permitted.

Two limits remain absolute: no circumvention of encryption, DRM or map
licensing, and no proprietary SDK whose EULA conflicts with GPL-3.0 — which
includes Garmin's own FIT SDK. Use the MIT-licensed FIT parser instead.
