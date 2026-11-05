# ADR 0007: GPL-3.0 licence and free distribution policy

Status: accepted
Date: 2026-11-05
Supersedes the licensing constraints in ADR 0006.

## Context

The owner set the project's licensing and distribution policy on 2026-11-05:
free to download and use, a community-friendly BaseCamp alternative, no
subscriptions, no mandatory accounts, no advertising, no paid feature tiers, no
cloud dependency for core functionality. Prefer open-source dependencies, permit
GPL-licensed dependencies where compatible, maintain a third-party licence
register, and ship the required notices and source. GPL-3.0 was proposed as the
application licence subject to a dependency licence audit.

The audit was the condition, so it was run before accepting the licence.

## Audit result

368 packages were installed and their declared licences classified for GPL-3.0
compatibility on 2026-11-05. Full results in
`docs/licences/third-party-register.md`.

| Verdict        | Count |
| -------------- | ----- |
| Compatible     | 366   |
| Needs decision | 2     |
| Incompatible   | 0     |

Distribution: 290 MIT, 26 ISC, 15 Apache-2.0, 11 BSD-3-Clause, 7 BSD-2-Clause,
6 Blue Oak, 2 MPL-2.0, and single instances of 0BSD, Python-2.0, CC-BY-4.0 and
various MIT dual-licences. All are inbound-compatible with GPL-3.0.

The two exceptions were both **react-leaflet** and its `@react-leaflet/core`
package, licensed **Hippocratic-2.1**. That licence conditions use on human
rights compliance and imposes an indemnity obligation on the licensee. Those are
additional restrictions beyond GPL-3.0's terms, which GPL-3.0 section 7 does not
permit, and the field-of-use restriction also means it is not OSI-approved open
source. It is therefore not redistributable as part of a GPL-3.0 work.

Resolved separately in ADR 0008: drop react-leaflet and use Leaflet
(BSD-2-Clause) directly.

A third finding came from outside the installed tree. **`@garmin/fitsdk`** is
governed by Garmin's "Flexible and Interoperable Data Transfer (FIT) Protocol
License Agreement", a bilateral proprietary agreement requiring acceptance
before use. It is not an open-source licence and cannot be combined into a
GPL-3.0 distribution. ADR 0006 is amended accordingly: the MIT-licensed
`fit-file-parser` becomes the primary FIT implementation rather than the
fallback.

With those three packages excluded, there is no remaining GPL-3.0 obstacle.

## Decision

**The application is licensed GPL-3.0-or-later.** `LICENSE` holds the full text.

What follows from it:

- **GPL dependencies are now permitted** where their version is compatible.
  This reverses ADR 0006's blanket exclusion. GPL-2.0-**only** remains
  incompatible with GPL-3.0; GPL-2.0-**or-later**, LGPL and AGPL-3.0 are fine.
- **GPSBabel becomes usable.** Its source headers grant GPL version 2 "or (at
  your option) any later version", making it GPL-2.0-or-later and compatible.
  This materially changes the GDB outlook — see ADR 0006 as amended.
- **Hippocratic, proprietary and custom-EULA dependencies are excluded**, both
  for licence compatibility and because they are not open source.
- **Source availability is an obligation, not a courtesy.** Every binary
  release must be accompanied by the complete corresponding source for the whole
  combined work, including any bundled GPL components.
- **No paywalls, telemetry gates or account requirements** may be introduced.
  The licence permits forking, so such a thing would be both contrary to policy
  and futile.

## Distribution

Public releases go to GitHub with a DMG for direct download. Notarisation is
compatible with GPL-3.0 — it attests to the binary rather than restricting the
user — and is the intended end state, but no Developer ID is available yet.
ADR 0009 covers the interim: ad-hoc signing with hardened runtime retained, and
the Gatekeeper friction documented for users.

**The Mac App Store is ruled out.** Its terms impose usage and copy restrictions
and a DRM layer that conflict with GPL-3.0 section 7's prohibition on further
restrictions, and with the anti-circumvention provisions in section 3. This is
the well-trodden ground that removed VLC from the store. Direct download remains
the distribution channel, which the policy already anticipated.

## Obligations to implement

These are requirements, not aspirations, and they are tracked as Phase 1 work:

1. `LICENSE` at the repository root with the full GPL-3.0 text. **Done.**
2. `docs/licences/third-party-register.md`, regenerated whenever dependencies
   change. **Done.**
3. An About window listing third-party components with their licences, and the
   written offer of source.
4. Per-file copyright and licence headers on source files.
5. A release process that publishes the corresponding source alongside every
   binary.

## Consequences

The project gains access to the GPL ecosystem, which is where most of the
mature GPS format tooling lives. That is a real capability gain for Garmin
compatibility, and it is the right trade given the policy's instruction to
prioritise functionality over proprietary licensing restrictions.

The cost is that permissively licensed downstream reuse is not possible, and
that one dependency choice (react-leaflet) and one planned dependency
(`@garmin/fitsdk`) had to change. Both changes are small and arguably
improvements on their own merits.

Dependency additions now require a licence check before they are added, not
after. Encoded as a steering rule in `.kiro/steering/licensing.md`.
