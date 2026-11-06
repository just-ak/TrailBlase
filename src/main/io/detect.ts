import { basename, extname } from 'node:path';
import {
  IMPORT_FORMATS,
  UNSUPPORTED_FORMATS,
  type ImportFormat,
} from '@shared/io/types';

/**
 * Identifies a file's format.
 *
 * Extension first, then content sniffing, because a mislabelled or
 * extension-less file is common — a GPX saved as `.xml`, or a download that
 * lost its suffix. Refusing those when we can plainly see what they are would
 * be unhelpful.
 *
 * GDB and IMG are recognised explicitly so the import dialog can explain why
 * they are not supported, rather than accepting the file and failing opaquely
 * later (ADR 0006).
 */

export type DetectionResult =
  | { kind: 'supported'; format: ImportFormat; byExtension: boolean }
  | { kind: 'unsupported'; format: string; reason: string }
  | { kind: 'unknown'; reason: string };

const EXTENSION_MAP: Record<string, ImportFormat> = {
  '.gpx': 'gpx',
  '.kml': 'kml',
  '.kmz': 'kmz',
  '.tcx': 'tcx',
  '.fit': 'fit',
  '.csv': 'csv',
  '.json': 'json',
};

const UNSUPPORTED_REASONS: Record<string, string> = {
  '.gdb': 'Garmin GDB is a proprietary binary format with no open parser. Export your data as GPX from BaseCamp instead.',
  '.img': 'Garmin IMG map files are not supported. TrailRT reads trip data, not map products.',
};

/** FIT files begin with a 12- or 14-byte header whose bytes 8–11 are ".FIT". */
function looksLikeFit(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  return (
    bytes[8] === 0x2e && // .
    bytes[9] === 0x46 && // F
    bytes[10] === 0x49 && // I
    bytes[11] === 0x54 // T
  );
}

/** Zip archives start with "PK\x03\x04". A KMZ is a zip. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function sniffText(bytes: Uint8Array): ImportFormat | null {
  // Only the head is decoded: a 22 MB GPX does not need fully decoding to be
  // recognised.
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 4096))
    .trimStart();

  if (/^<\?xml/i.test(head) || head.startsWith('<')) {
    // The character class includes `/` so a self-closing root element —
    // `<gpx/>`, `<TrainingCenterDatabase/>` — is still recognised.
    if (/<gpx[\s/>]/i.test(head)) return 'gpx';
    if (/<kml[\s/>]/i.test(head)) return 'kml';
    if (/<TrainingCenterDatabase[\s/>]/i.test(head)) return 'tcx';
    return null;
  }

  if (head.startsWith('{') || head.startsWith('[')) {
    // Only our own backup envelope counts as importable JSON.
    return /"trailrt"/i.test(head) ? 'json' : null;
  }

  // A CSV needs a header row naming at least a latitude-ish column, otherwise
  // any comma-separated text would qualify.
  const firstLine = head.split(/\r?\n/)[0] ?? '';
  if (/[,;\t]/.test(firstLine) && /lat/i.test(firstLine)) return 'csv';

  return null;
}

export function detectFormat(
  filePath: string,
  bytes: Uint8Array,
): DetectionResult {
  const extension = extname(filePath).toLowerCase();

  const unsupportedReason = UNSUPPORTED_REASONS[extension];
  if (unsupportedReason !== undefined) {
    return {
      kind: 'unsupported',
      format: extension.slice(1),
      reason: unsupportedReason,
    };
  }

  // Content wins over extension for the binary formats, because their
  // signatures are unambiguous and a wrong extension is otherwise fatal.
  if (looksLikeFit(bytes)) {
    return { kind: 'supported', format: 'fit', byExtension: false };
  }
  if (looksLikeZip(bytes)) {
    return { kind: 'supported', format: 'kmz', byExtension: extension === '.kmz' };
  }

  const byExtension = EXTENSION_MAP[extension];
  if (byExtension !== undefined) {
    // Trust the extension unless the content plainly contradicts it.
    const sniffed = sniffText(bytes);
    if (sniffed !== null && sniffed !== byExtension) {
      return { kind: 'supported', format: sniffed, byExtension: false };
    }
    return { kind: 'supported', format: byExtension, byExtension: true };
  }

  const sniffed = sniffText(bytes);
  if (sniffed !== null) {
    return { kind: 'supported', format: sniffed, byExtension: false };
  }

  return {
    kind: 'unknown',
    reason: `"${basename(filePath)}" is not a format TrailRT recognises. Supported: ${IMPORT_FORMATS.join(', ')}.`,
  };
}

export function isUnsupportedExtension(filePath: string): boolean {
  const extension = extname(filePath).toLowerCase().slice(1);
  return (UNSUPPORTED_FORMATS as readonly string[]).includes(extension);
}
