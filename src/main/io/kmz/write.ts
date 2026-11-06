import JSZip from 'jszip';
import { writeKml, type WriteKmlInput } from '../kml/write';

/**
 * KMZ writer: one `doc.kml` in a zip.
 *
 * `doc.kml` at the archive root is the name every KML reader looks for first,
 * so using it keeps the output readable by Google Earth and BaseCamp without
 * them having to guess.
 *
 * DEFLATE at level 9 because KML is highly compressible text — a 200,000-point
 * track is tens of megabytes as KML and compresses by roughly an order of
 * magnitude, and the write happens once.
 *
 * `date` is fixed rather than `new Date()` so the same data produces the same
 * bytes. Deterministic output means an export can be diffed and a round-trip
 * test can compare archives, not just their contents.
 */
const FIXED_DATE = new Date(Date.UTC(1980, 0, 1));

export async function writeKmz(input: WriteKmlInput): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('doc.kml', writeKml(input), { date: FIXED_DATE });

  const buffer = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  return buffer;
}
