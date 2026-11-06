/**
 * Generates the third-party licence list shown in the About window, and the
 * register in docs/licences/.
 *
 * GPL-3.0 obliges us to reproduce third-party notices, and a hand-maintained
 * list drifts from the lockfile immediately. Run after any dependency change:
 *
 *   npm run licences
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modulesDir = join(root, 'node_modules');

/** Shipped to users, so these licences bind the combined work. */
const SHIPPED = new Set([
  'better-sqlite3',
  'drizzle-orm',
  'electron',
  'leaflet',
  'react',
  'react-dom',
  'zod',
  'zustand',
]);

const PERMISSIVE = new Set([
  'MIT', 'MIT-0', 'ISC', 'BSD', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
  'Apache-2.0', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Python-2.0',
  'Zlib', 'WTFPL', 'MPL-2.0', 'CC-BY-4.0', 'CC-BY-3.0', 'Artistic-2.0',
  'PostgreSQL', 'BSL-1.0', 'UPL-1.0', 'OFL-1.1',
]);

function classify(lic) {
  if (!lic) return 'UNKNOWN';
  const s = String(lic).trim();
  if (/^SEE LICEN[CS]E/i.test(s)) return 'CUSTOM';
  if (/^UNLICENSED$/i.test(s)) return 'PROPRIETARY';
  if (s.includes('OR')) {
    return s.replace(/[()]/g, '').split(/\s+OR\s+/).some((p) => classify(p.trim()) === 'COMPATIBLE')
      ? 'COMPATIBLE' : 'REVIEW';
  }
  if (s.includes('AND')) {
    return s.replace(/[()]/g, '').split(/\s+AND\s+/).every((p) => classify(p.trim()) === 'COMPATIBLE')
      ? 'COMPATIBLE' : 'REVIEW';
  }
  if (PERMISSIVE.has(s)) return 'COMPATIBLE';
  if (/GPL-2\.0(-only)?$/.test(s)) return 'INCOMPATIBLE';
  if (/^(GPL|LGPL|AGPL)-[23]/.test(s)) return 'COMPATIBLE';
  return 'REVIEW';
}

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === '.bin' || entry === '.cache') continue;
    const p = join(dir, entry);
    if (entry.startsWith('@')) { walk(p, out); continue; }
    const manifest = join(p, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
        if (pkg.name && pkg.version) {
          const lic = pkg.license ?? (Array.isArray(pkg.licenses)
            ? pkg.licenses.map((l) => l.type).join(' OR ') : null);
          out.set(pkg.name, { version: pkg.version, licence: lic ?? '(none declared)' });
        }
      } catch { /* unreadable manifest */ }
    }
    walk(join(p, 'node_modules'), out);
  }
}

const all = new Map();
walk(modulesDir, all);

const flagged = [...all.entries()].filter(
  ([, i]) => classify(i.licence) !== 'COMPATIBLE',
);

if (flagged.length > 0) {
  console.error('\nLicence check FAILED. These are not compatible with GPL-3.0:\n');
  for (const [name, i] of flagged) {
    console.error(`  ${name}@${i.version}  ->  ${i.licence}  [${classify(i.licence)}]`);
  }
  console.error('\nSee .kiro/steering/licensing.md. Remove or replace them.\n');
  process.exit(1);
}

// ---- About-window list: what users actually receive, sorted for stability.
const shipped = [...all.entries()]
  .filter(([name]) => SHIPPED.has(name))
  .map(([name, i]) => ({ name, version: i.version, licence: i.licence }))
  .sort((a, b) => a.name.localeCompare(b.name));

const tsOut = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate with \`npm run licences\` after any dependency change.
 *
 * Reproduced in the About window to satisfy the GPL-3.0 obligation to carry
 * third-party notices. See .kiro/steering/licensing.md.
 */
import type { LicenceEntry } from '@shared/ipc/api';

export const THIRD_PARTY_LICENCES: readonly LicenceEntry[] = ${JSON.stringify(shipped, null, 2)};

/** Chromium and Node.js reach users bundled inside Electron. */
export const RUNTIME_NOTICES: readonly LicenceEntry[] = [
  { name: 'Chromium', version: 'bundled with Electron', licence: 'BSD-3-Clause and others' },
  { name: 'Node.js', version: 'bundled with Electron', licence: 'MIT' },
];
`;

writeFileSync(join(root, 'src/main/licences.ts'), tsOut);

// ---- Full register for docs/
const byLicence = new Map();
for (const [, i] of all) {
  byLicence.set(i.licence, (byLicence.get(i.licence) ?? 0) + 1);
}

const lines = [
  '# Third-party dependency and licence register',
  '',
  'Required by the project licensing policy and by ADR 0007. The application is',
  'licensed GPL-3.0-or-later; every entry here must be inbound-compatible with that.',
  '',
  '**GENERATED FILE** — regenerate with `npm run licences`.',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} from the installed dependency tree`,
  `on Node ${process.version}. Packages examined: **${all.size}**. Incompatibilities: **0**.`,
  '',
  '## Licence distribution',
  '',
  '| Licence | Packages |',
  '| --- | --- |',
  ...[...byLicence].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lic, n]) => `| ${lic} | ${n} |`),
  '',
  '## Shipped in the application bundle',
  '',
  'Distributed to users, so these licences bind the combined work.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...shipped.map((p) => `| \`${p.name}\` | ${p.version} | ${p.licence} |`),
  '| Chromium | bundled with Electron | BSD-3-Clause and others |',
  '| Node.js | bundled with Electron | MIT |',
  '',
  '## Rejected on licence grounds',
  '',
  '| Package | Licence | Reason | Replacement |',
  '| --- | --- | --- | --- |',
  '| `react-leaflet` | Hippocratic-2.1 | Use restrictions and an indemnity obligation are further restrictions GPL-3.0 §7 forbids; not OSI-approved | Leaflet used directly, ADR 0008 |',
  '| `@garmin/fitsdk` | Proprietary FIT Protocol License Agreement | Bilateral EULA; not open source, cannot combine with GPL-3.0 | `fit-file-parser` (MIT), ADR 0006 |',
  '',
  '## Full dependency list',
  '',
  '<details>',
  `<summary>All ${all.size} packages</summary>`,
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...[...all.keys()].sort().map((n) => {
    const i = all.get(n);
    return `| \`${n}\` | ${i.version} | ${i.licence} |`;
  }),
  '',
  '</details>',
  '',
];

mkdirSync(join(root, 'docs/licences'), { recursive: true });
writeFileSync(join(root, 'docs/licences/third-party-register.md'), lines.join('\n'));

console.log(`Licence check passed: ${all.size} packages, 0 incompatible.`);
console.log('Wrote src/main/licences.ts and docs/licences/third-party-register.md');
