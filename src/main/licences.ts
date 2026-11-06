/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with `npm run licences` after any dependency change.
 *
 * Reproduced in the About window to satisfy the GPL-3.0 obligation to carry
 * third-party notices. See .kiro/steering/licensing.md.
 */
import type { LicenceEntry } from '@shared/ipc/api';

export const THIRD_PARTY_LICENCES: readonly LicenceEntry[] = [
  {
    "name": "better-sqlite3",
    "version": "13.0.3",
    "licence": "MIT"
  },
  {
    "name": "drizzle-orm",
    "version": "0.45.4",
    "licence": "Apache-2.0"
  },
  {
    "name": "electron",
    "version": "45.2.3",
    "licence": "MIT"
  },
  {
    "name": "leaflet",
    "version": "1.9.4",
    "licence": "BSD-2-Clause"
  },
  {
    "name": "react",
    "version": "19.3.1",
    "licence": "MIT"
  },
  {
    "name": "react-dom",
    "version": "19.3.1",
    "licence": "MIT"
  },
  {
    "name": "zod",
    "version": "4.6.7",
    "licence": "MIT"
  },
  {
    "name": "zustand",
    "version": "5.0.16",
    "licence": "MIT"
  }
];

/** Chromium and Node.js reach users bundled inside Electron. */
export const RUNTIME_NOTICES: readonly LicenceEntry[] = [
  { name: 'Chromium', version: 'bundled with Electron', licence: 'BSD-3-Clause and others' },
  { name: 'Node.js', version: 'bundled with Electron', licence: 'MIT' },
];
