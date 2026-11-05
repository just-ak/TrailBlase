# ADR 0006: Garmin proprietary formats — scope and licensing

Status: accepted, amended 2026-11-05 by ADR 0007
Date: 2026-11-05

> **Amendment.** This ADR was written before the project had a licence, and
> assumed a proprietary one. ADR 0007 set the licence to GPL-3.0-or-later, which
> inverts two of the conclusions below:
>
> - **GPSBabel is now permitted.** Its source grants GPL version 2 "or any later
>   version", making it GPL-2.0-or-later and compatible with GPL-3.0. The "do
>   not bundle GPL tooling" rule below no longer applies, and GDB support is
>   consequently viable rather than merely investigable.
> - **`@garmin/fitsdk` is now rejected.** Its licence was read: it is the
>   bilateral "FIT Protocol License Agreement", a proprietary EULA requiring
>   acceptance before use. It cannot be combined into a GPL-3.0 work. The
>   MIT-licensed `fit-file-parser` is promoted from fallback to primary, and the
>   licence review gate is closed — the answer is no.
>
> Unchanged: no circumvention of encryption, DRM or map licensing, and no
> claiming support for a format untested against real sample files.

## Context

Sections 9 and 10 ask for GDB and IMG compatibility, with GDB "if a suitable
parser is available" and IMG as an architectural allowance rather than a Phase 1
feature.

Findings from a registry survey on 2026-11-05:

- **FIT**: `@garmin/fitsdk` 21.221.0 is the official Garmin JavaScript SDK,
  published by Garmin and actively maintained. Its licence is a custom file
  (`SEE LICENSE IN LICENSE.txt`), not an SPDX identifier, so it needs a read
  before shipping. `fit-file-parser` 6.2.7 is an MIT alternative.
- **GDB**: no JavaScript parser exists on npm. The only mature reader is
  GPSBabel, which is GPL-licensed and a separate native binary.
- **IMG**: the tooling ecosystem (mkgmap, GMapTool and relatives) is Java and
  largely GPL. There is no JavaScript renderer.

## Decision

Formats are tiered by what can actually be supported.

**Implement** (Phase 3): GPX, KML, KMZ, TCX, CSV, JSON. All are open, text or
zip based, and parseable with `fast-xml-parser` (MIT), `@tmcw/togeojson`
(BSD-2-Clause) and `jszip`.

**Implement with a licence review gate** (Phase 3): FIT, via `@garmin/fitsdk`.
The SDK licence must be read and recorded in this ADR before the dependency is
added. If its terms do not permit redistribution in a packaged desktop app,
fall back to `fit-file-parser` (MIT).

**Investigate only, do not implement** (Phase 5): GDB and IMG. The deliverable
is a written findings document covering file structure, available tooling and
licensing — not a parser.

Two constraints hold regardless:

- GPSBabel is not bundled or linked. Its GPL terms would propagate to the
  distributed application. If GDB support is ever shipped it must be via an
  independently written parser or an optional user-installed external tool
  invoked at arm's length, and that is a decision for a future ADR.
- No circumvention of encryption, DRM or map licensing. Locked Garmin map
  products are out of scope permanently, not just for now.

## Consequences

The application will not claim GDB or IMG support. The import dialog lists GDB
as unsupported with a short explanation, rather than accepting the file and
failing opaquely.

A format is only advertised as supported once it has round-tripped against real
sample files in `test-data/`. Until then it stays off the supported list.
