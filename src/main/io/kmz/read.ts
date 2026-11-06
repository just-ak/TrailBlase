import { basename } from 'node:path';
import JSZip from 'jszip';
import { ParseError, type ParsedFile } from '@shared/io/types';
import { readKml } from '../kml/read';

/**
 * KMZ reader.
 *
 * A KMZ is a zip whose primary entry is a KML document. The Google spec names
 * `doc.kml` at the archive root as the convention, but plenty of real archives
 * use another name, so the lookup is: `doc.kml` at the root, then the first
 * `.kml` entry in path order.
 *
 * Ordering matters for determinism. jszip's object key order follows insertion,
 * which follows the central directory, which is not guaranteed to be sorted —
 * so entries are sorted explicitly rather than relying on it. Two imports of
 * the same file must pick the same document.
 *
 * Other archive contents (icons, overlay imagery, nested KML) are reported as
 * skipped rather than ignored. A user whose KMZ carried five documents should
 * be told that four were not read.
 */

/**
 * Zip entries are untrusted input; a path leaving the archive is refused.
 *
 * Nothing in TrailRT writes archive entries to disk, so this is not currently
 * load-bearing. It is here because the moment anything does — extracting a KMZ
 * overlay image, say — the check needs to already exist rather than be
 * remembered. Exported so it can be tested directly: jszip normalises names
 * when *writing*, so a hostile archive cannot be constructed with its builder.
 */
export function isSafeEntryPath(path: string): boolean {
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return false;
  return !path.split('/').includes('..');
}

export async function readKmz(
  bytes: Uint8Array,
  sourcePath: string,
): Promise<ParsedFile> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (cause) {
    throw new ParseError(
      'kmz',
      'This file is not a readable zip archive, so it cannot be a KMZ.',
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const unsafe = entries.filter((entry) => !isSafeEntryPath(entry.name));
  const safe = entries.filter((entry) => isSafeEntryPath(entry.name));

  const kmlEntries = safe.filter((entry) =>
    entry.name.toLowerCase().endsWith('.kml'),
  );

  const primary =
    kmlEntries.find((entry) => entry.name.toLowerCase() === 'doc.kml') ??
    kmlEntries[0];

  if (primary === undefined) {
    throw new ParseError(
      'kmz',
      'This KMZ contains no KML document, so there is nothing to import.',
      `Entries: ${entries.map((e) => e.name).join(', ') || '(none)'}`,
    );
  }

  const content = await primary.async('string');

  // Parsed as the KMZ format so the report names what the user actually
  // chose, not the document hidden inside it.
  const file = readKml(content, sourcePath, 'kmz');
  file.sourceName = basename(sourcePath);

  if (primary.name.toLowerCase() !== 'doc.kml') {
    file.warnings.push(
      `The archive has no doc.kml; "${primary.name}" was read instead.`,
    );
  }

  for (const entry of kmlEntries) {
    if (entry === primary) continue;
    file.skipped.push({
      kind: 'document',
      name: entry.name,
      reason:
        'A KMZ has one primary document; additional KML files were not read. Import it separately if you need it.',
    });
  }

  for (const entry of safe) {
    if (entry.name.toLowerCase().endsWith('.kml')) continue;
    file.skipped.push({
      kind: 'resource',
      name: entry.name,
      reason: 'Archive resource (icon, image or overlay). TrailRT reads trip data only.',
    });
  }

  for (const entry of unsafe) {
    file.skipped.push({
      kind: 'resource',
      name: entry.name,
      reason: 'Entry path escapes the archive and was refused.',
    });
  }

  return file;
}
