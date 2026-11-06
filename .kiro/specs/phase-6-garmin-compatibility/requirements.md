# Phase 6: Garmin Compatibility — Requirements

Status: not started. Blocked on Phase 4.

## Introduction

Phase 6 is predominantly an **investigation** phase. Its primary deliverables
are documented findings, not features. That framing is deliberate: GDB and IMG
are proprietary formats with no viable JavaScript tooling and real licensing
constraints, as established in ADR 0006.

Nothing in this phase may be advertised as supported until it has been tested
against real sample files.

## Requirements

### Requirement 1: GDB support

**Deliverable:** a findings document, and an implementation if the findings
support one. The project's GPL-3.0 licence permits GPSBabel
(GPL-2.0-or-later), so unlike the other items in this phase this one has a
realistic path to being a feature.

#### Acceptance criteria

1. THE investigation SHALL document the GDB container structure, versions in
   circulation, and which record types carry routes, tracks and waypoints.
2. THE investigation SHALL compare two routes to support: invoking GPSBabel, or
   writing an independent parser. It SHALL cover, for the GPSBabel route, the
   obligation to publish its corresponding source, the practical cost of
   signing and notarising a nested Qt-linked binary inside the app bundle, and
   the size impact.
3. THE investigation SHALL recommend one route with reasoning.
4. WHERE GPSBabel is bundled THE release process SHALL publish its complete
   corresponding source alongside the binary, as GPL-3.0 requires.
5. IF GDB reading is implemented THEN it SHALL be validated against real sample
   files before appearing in the supported format list.
6. UNTIL then THE import dialog SHALL list GDB as not yet supported with a
   short explanation.

### Requirement 2: Garmin IMG investigation

**Deliverable:** a findings document and an interface design.

#### Acceptance criteria

1. THE investigation SHALL document IMG file structure, subfile organisation,
   map indexing, and metadata.
2. THE investigation SHALL document the licensing position for Garmin map
   products, distinguishing freely redistributable community maps from locked
   commercial products.
3. THE system SHALL NOT attempt to bypass encryption, DRM or map licensing
   under any circumstances.
4. THE phase SHALL produce a `GarminMapProvider` interface design that fits the
   existing `MapProvider` abstraction, with Garmin map parsing separated from
   the mapping interface.
5. A complete IMG renderer is explicitly NOT required. The architecture SHALL
   be shown not to prevent one.
6. IF a reader is prototyped THEN it SHALL be scoped to metadata and index
   reading before any rendering work.

### Requirement 3: Device transfer investigation

#### Acceptance criteria

1. THE investigation SHALL document how modern Garmin devices present
   themselves on macOS, distinguishing USB mass storage from MTP.
2. THE investigation SHALL document the on-device directory conventions for
   GPX and FIT files.
3. WHERE a device mounts as mass storage THE system SHALL be able to detect it
   and offer file-level transfer using already-implemented formats, which is
   feature work that follows from the investigation.
4. THE system SHALL NOT write to a device without explicit confirmation naming
   the device and the files.
5. MTP-only devices SHALL be reported as unsupported rather than partially
   handled.

### Requirement 4: Expanded import and export

#### Acceptance criteria

1. THE system SHALL improve Garmin symbol vocabulary fidelity on GPX export,
   validated against real Garmin-authored files.
2. THE system SHALL support Garmin GPX extension namespaces for round-tripping
   where documented.
3. A `GarminCompatibility` module SHALL encapsulate all Garmin-specific
   quirks, separate from the general format readers.

### Requirement 5: Compatibility testing

#### Acceptance criteria

1. THE system SHALL be tested against files exported by real Garmin devices and
   by BaseCamp itself.
2. Test files SHALL be synthetic or explicitly licensed for this use. Real user
   GPS data SHALL NOT be used.
3. THE supported format list SHALL be updated only on the basis of passing
   tests against real samples.
4. Findings SHALL be recorded as ADRs where they constitute decisions.
