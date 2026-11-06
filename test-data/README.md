# Test fixtures

**Every file here is synthetic.** No real user GPS data is used in automated
tests, as Requirement 8.2 and `.kiro/steering/architecture.md` both require.
Coordinates are invented and sit in the Swiss and Italian Alps because that is a
plausible region for the trips this app is for, not because anyone went there.

Generated binary and bulk fixtures are not committed. Run:

```sh
npm run fixtures
```

to produce `generated/` (KMZ, FIT, and a large GPX). The generator is
`scripts/generate-fixtures.mjs`.

## Hand-written fixtures

| File                  | Covers                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `alps-full.gpx`       | GPX 1.1 with waypoints, a route and a multi-segment track, all with elevation and time                          |
| `legacy-1.0.gpx`      | GPX 1.0, where elevation and time are present but the namespace differs                                         |
| `no-elevation.gpx`    | Points with no `<ele>` at all — must import as `null`, never `0`                                                |
| `no-time.gpx`         | Track with no timestamps, so duration is unavailable rather than zero                                           |
| `multi-segment.gpx`   | A single track split across three `<trkseg>` elements                                                           |
| `with-extensions.gpx` | Garmin and custom extension namespaces that have no column, so must be reported as unmapped rather than dropped |
| `unknown-symbol.gpx`  | A `<sym>` outside our vocabulary, which must survive verbatim for export                                        |
| `empty.gpx`           | Valid GPX containing nothing — a successful import of zero objects, not an error                                |
| `malformed.gpx`       | Truncated XML, which must fail with a located message and import nothing                                        |
| `places.kml`          | KML `Placemark` Point and LineString, plus `ExtendedData`                                                       |
| `gx-track.kml`        | Google `gx:Track` with `when`/`gx:coord` pairs                                                                  |
| `activity.tcx`        | TCX activity with heart rate and cadence, which become unmapped metadata                                        |
| `waypoints.csv`       | CSV waypoints with quoted fields, an embedded comma, and a blank elevation                                      |
| `headers-odd.csv`     | Non-standard column names, to exercise header mapping                                                           |

## Coordinate conventions, deliberately differing

A frequent source of silent bugs, so each is covered by its own test:

- **GPX** uses `lat` and `lon` attributes.
- **KML** uses `lon,lat,ele` in a single text node — the opposite order.
- **FIT** stores semicircles: `degrees = semicircles × (180 / 2^31)`.

## FIT is inherently lossy, and tests must not pretend otherwise

The "preserve values exactly" rule applies to what a format can represent. FIT
cannot represent arbitrary doubles:

- Coordinates are 32-bit semicircles, so a degree value quantises to about
  2 × 10⁻⁸° — roughly 2 mm. Writing 46.5197 and reading 46.51969998 is correct
  behaviour, not a bug.
- Altitude is a uint16 with scale 5 and offset 500, giving 0.2 m resolution.
  1850.5 m round-trips as 1850.6 m.

FIT tests therefore assert closeness with an explicit tolerance and a comment
saying why. GPX, KML and CSV tests assert exact equality, because those formats
are text and genuinely can round-trip a double.
