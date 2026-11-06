import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  cleanup,
  close,
  launch,
  makeUserDataDir,
  type Harness,
} from './helpers';

/**
 * Phase 3 acceptance criteria, against the built application:
 *
 *   1. existing GPX files import, and their routes, tracks and waypoints show
 *   2. exported GPX reopens with the same geometry
 *   3. import warnings are visible in the report
 *   4. a malformed file is refused with no partial import
 *   5. tracks survive a restart
 *
 * The native file dialogs are replaced in the **main process** with
 * `app.evaluate`, which is what makes this testable: everything downstream of
 * the dialog — the handler, staging, parsing, the transaction, the report — is
 * the real code path. Stubbing in the renderer instead would skip all of it.
 */

const FIXTURES = resolve('test-data');

let userDataDir: string;
let harness: Harness;
let scratch: string;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  scratch = mkdtempSync(join(tmpdir(), 'trailrt-e2e-files-'));
  harness = await launch(userDataDir);
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
  rmSync(scratch, { recursive: true, force: true });
});

/** Makes the next Import… use these paths instead of opening a dialog. */
async function stubOpenDialog(paths: readonly string[]): Promise<void> {
  await harness.app.evaluate(
    ({ dialog }, filePaths: string[]) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    },
    [...paths],
  );
}

/** Makes the next Export… write here instead of opening a dialog. */
async function stubSaveDialog(filePath: string): Promise<void> {
  await harness.app.evaluate(({ dialog }, target: string) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, filePath);
}

/**
 * Opens the import dialog from the library toolbar.
 *
 * Not the menu accelerator: a native Electron menu does not receive key events
 * sent to the renderer, so pressing Shift-Cmd-I here would do nothing. The
 * toolbar button dispatches the same action.
 */
async function startImport(page: Page): Promise<void> {
  // By accessible name, not visible text: the trip panel and the import dialog
  // both have an "Import" button, and only this one opens the file chooser.
  await page.getByRole('button', { name: 'Import files' }).click();
}

async function openImport(page: Page): Promise<void> {
  await startImport(page);
  await page
    .getByRole('heading', { name: /^Import \d+ file/ })
    .waitFor({ timeout: 20_000 });
}

/**
 * Clicks a button that replaces or closes the modal.
 *
 * `dispatchEvent` rather than `click`: a real mouse click on a button inside a
 * native `<dialog>` in the top layer hangs Playwright's post-click wait when
 * the handler unmounts that dialog. The dispatched event exercises the same
 * React handler without the input-completion round trip.
 */
async function clickAndReplaceModal(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name }).dispatchEvent('click');
}

/**
 * Expands a tree view so its children are rendered.
 *
 * Collapsed branches are not in the DOM, so a row inside one simply does not
 * exist for a locator. Creating a trip through the UI expands the branch as a
 * side effect; importing does not, so the test has to.
 */
async function expandView(page: Page, label: RegExp): Promise<void> {
  const row = page.getByRole('treeitem', { name: label });
  await row.waitFor();
  if ((await row.getAttribute('aria-expanded')) === 'true') return;
  // The chevron is aria-hidden by design — expansion is already conveyed by
  // the row's aria-expanded — so it is reached positionally.
  await row.locator('button').first().click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}

/** Runs the import and waits for the report. */
async function confirmImport(page: Page): Promise<void> {
  await clickAndReplaceModal(page, 'Confirm import');
  await page
    .getByRole('heading', { name: 'Import report' })
    .waitFor({ timeout: 30_000 });
}

async function closeReport(page: Page): Promise<void> {
  await clickAndReplaceModal(page, 'Close import report');
  await page.getByRole('heading', { name: 'Import report' }).waitFor({
    state: 'detached',
  });
}

test.describe('import', () => {
  test('imports a GPX file and shows its objects in the library', async () => {
    const { page } = harness;

    await stubOpenDialog([join(FIXTURES, 'alps-full.gpx')]);
    await openImport(page);

    // The preview appears with nothing yet written.
    await expect(page.getByText('alps-full.gpx').first()).toBeVisible();
    await expect(page.getByLabel('Destination trip')).toBeVisible();

    await confirmImport(page);
    await expect(page.getByText(/waypoints \(/)).toBeVisible();
    await closeReport(page);

    // A trip named after the file, containing what the file held.
    await expandView(page, /^Trips/);
    const trip = page.getByRole('treeitem', { name: /alps-full/ });
    await expect(trip).toBeVisible();
    await trip.click();

    const counts = await page.evaluate(async () => {
      const trips = await window.trailrt.trips.list({ includeArchived: true });
      if (!trips.ok) return null;
      const target = trips.data.find((t) => t.name === 'alps-full');
      if (target === undefined) return null;
      return {
        routes: target.routeCount,
        tracks: target.trackCount,
        waypoints: target.waypointCount,
      };
    });

    expect(counts).not.toBeNull();
    expect(counts?.routes).toBeGreaterThan(0);
    expect(counts?.tracks).toBeGreaterThan(0);
    expect(counts?.waypoints).toBeGreaterThan(0);
  });

  test('draws the imported track on the map', async () => {
    const { page } = harness;
    await expandView(page, /^Trips/);
    await page.getByRole('treeitem', { name: /alps-full/ }).click();

    /*
     * Polylines are drawn to a **canvas**, not to SVG, so there is no `path`
     * element to count — Leaflet's canvas renderer is what keeps a
     * 200,000-point track interactive. What is inspectable is the marker pane:
     * a track contributes start and finish badges, and the trip's waypoints
     * contribute their own markers.
     */
    await expect
      .poll(
        async () =>
          page.locator('.leaflet-marker-pane > *').count(),
        { timeout: 15_000 },
      )
      .toBeGreaterThan(1);

    // And the geometry the layer draws from is really there.
    const drawn = await page.evaluate(async () => {
      const list = await window.trailrt.tracks.listAll();
      if (!list.ok) return null;
      const id = list.data[0]?.id;
      if (id === undefined) return null;
      const result = await window.trailrt.tracks.geometry({ id, zoom: 14 });
      if (!result.ok) return null;
      return {
        simplified: result.data.simplified,
        points: result.data.segments.reduce(
          (sum, segment) => sum + segment.points.length,
          0,
        ),
      };
    });

    expect(drawn?.points).toBeGreaterThan(1);
    // Above the cache threshold the real samples are returned, and the
    // response says so rather than leaving the caller to guess.
    expect(drawn?.simplified).toBe(false);
  });

  test('returns the simplified render cache at a low zoom', async () => {
    const { page } = harness;
    const cached = await page.evaluate(async () => {
      const list = await window.trailrt.tracks.listAll();
      if (!list.ok) return null;
      const id = list.data[0]?.id;
      if (id === undefined) return null;
      const result = await window.trailrt.tracks.geometry({ id, zoom: 4 });
      return result.ok ? result.data.simplified : null;
    });

    expect(cached).toBe(true);
  });

  test('shows a track in the cross-trip Tracks view', async () => {
    const { page } = harness;
    const tracks = page.getByRole('treeitem', { name: /^Tracks/ });
    await tracks.click();
    // The view is populated as of Phase 3, not marked unavailable.
    await expect(tracks).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('selecting a track shows its properties, with honest gaps', async () => {
    const { page } = harness;

    const trackName = await page.evaluate(async () => {
      const result = await window.trailrt.tracks.listAll();
      return result.ok ? (result.data[0]?.name ?? null) : null;
    });
    expect(trackName).not.toBeNull();

    await expandView(page, /^Trips/);
    const trip = page.getByRole('treeitem', { name: /alps-full/ });
    await trip.click();
    if ((await trip.getAttribute('aria-expanded')) !== 'true') {
      await trip.locator('button').first().click();
    }

    await page
      .getByRole('treeitem', { name: new RegExp(trackName as string) })
      .first()
      .click();

    await expect(page.getByRole('heading', { name: 'Track' })).toBeVisible();
    await expect(page.getByLabel('Track name')).toHaveValue(
      trackName as string,
    );

    // Simplify is previewed before it is applied, because the undo stack
    // cannot carry the inverse of a large geometry edit.
    await expect(page.getByLabel('Simplification tolerance')).toBeVisible();
    await expect(page.getByText(/points →|No points would be removed/)).toBeVisible();

    // The fixture's track is timed, so a duration is shown rather than a gap.
    await expect(page.getByText(/^Duration$/)).toBeVisible();
    await expect(
      page.getByText('This recording has no timestamps, so it has no duration.'),
    ).toHaveCount(0);
  });
});

test.describe('import reporting', () => {
  test('lists warnings and preserved metadata in the report', async () => {
    const { page } = harness;

    await stubOpenDialog([join(FIXTURES, 'with-extensions.gpx')]);
    await openImport(page);

    // Named before the import, so the user can see what will happen.
    await expect(
      page.getByText(/Will be preserved without a field of its own/),
    ).toBeVisible();

    await confirmImport(page);
    await expect(
      page.getByText(/Preserved without a field of its own/),
    ).toBeVisible();
    await closeReport(page);
  });

  test('refuses a malformed file and imports nothing', async () => {
    const { page } = harness;

    const before = await page.evaluate(async () => {
      const result = await window.trailrt.trips.list({ includeArchived: true });
      return result.ok ? result.data.length : -1;
    });

    await stubOpenDialog([join(FIXTURES, 'malformed.gpx')]);
    await startImport(page);

    // Staged with its error rather than silently dropped.
    await expect(page.getByText('malformed.gpx')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/not valid XML/)).toBeVisible();

    // Nothing importable, so the action is unavailable.
    await expect(
      page.getByRole('button', { name: 'Confirm import' }),
    ).toBeDisabled();
    await clickAndReplaceModal(page, 'Cancel import');

    const after = await page.evaluate(async () => {
      const result = await window.trailrt.trips.list({ includeArchived: true });
      return result.ok ? result.data.length : -1;
    });
    expect(after).toBe(before);
  });

  test('records every attempt in the import history', async () => {
    const { page } = harness;
    const history = await page.evaluate(async () => {
      const result = await window.trailrt.importing.history({ limit: 50 });
      return result.ok
        ? result.data.map((entry) => [entry.sourceName, entry.status])
        : [];
    });

    expect(history.length).toBeGreaterThan(0);
    expect(history.map(([name]) => name)).toContain('alps-full.gpx');
  });
});

test.describe('export', () => {
  test('exports GPX and re-imports it with identical geometry', async () => {
    const { page } = harness;
    const target = join(scratch, 'roundtrip.gpx');

    const before = await page.evaluate(async () => {
      const trips = await window.trailrt.trips.list({ includeArchived: true });
      if (!trips.ok) return null;
      const trip = trips.data.find((t) => t.name === 'alps-full');
      if (trip === undefined) return null;
      const geometry = await window.trailrt.geometry.forTrip({
        tripId: trip.id,
      });
      if (!geometry.ok) return null;
      return {
        tripId: trip.id,
        routes: geometry.data.routes.map((route) => ({
          name: route.name,
          points: route.points.map((p) => [p.lat, p.lon, p.ele]),
        })),
        waypoints: geometry.data.waypoints.map((w) => [
          w.name,
          w.lat,
          w.lon,
          w.eleM,
        ]),
      };
    });
    expect(before).not.toBeNull();

    await stubSaveDialog(target);
    await page.evaluate(async (tripId: string) => {
      const result = await window.trailrt.exporting.run({
        scope: { kind: 'trips', tripIds: [tripId] },
        format: 'gpx',
      });
      if (!result.ok) throw new Error(result.error.message);
    }, before?.tripId as string);

    // The file exists and is real GPX.
    const written = readFileSync(target, 'utf8');
    expect(written).toContain('<gpx');
    expect(written).toContain('creator="TrailRT"');

    await stubOpenDialog([target]);
    await openImport(page);
    await confirmImport(page);
    await closeReport(page);

    const after = await page.evaluate(async () => {
      const trips = await window.trailrt.trips.list({ includeArchived: true });
      if (!trips.ok) return null;
      const trip = trips.data.find((t) => t.name === 'roundtrip');
      if (trip === undefined) return null;
      const geometry = await window.trailrt.geometry.forTrip({
        tripId: trip.id,
      });
      if (!geometry.ok) return null;
      return {
        routes: geometry.data.routes.map((route) => ({
          name: route.name,
          points: route.points.map((p) => [p.lat, p.lon, p.ele]),
        })),
        waypoints: geometry.data.waypoints.map((w) => [
          w.name,
          w.lat,
          w.lon,
          w.eleM,
        ]),
      };
    });

    expect(after).not.toBeNull();
    // Exact equality, including the nulls: GPX is text and can round-trip a
    // double. No tolerance is appropriate here.
    expect(after?.routes).toEqual(before?.routes);
    expect(after?.waypoints).toEqual(before?.waypoints);
  });

  test('names what a format will drop before writing it', async () => {
    const { page } = harness;

    const tripId = await page.evaluate(async () => {
      const trips = await window.trailrt.trips.list({ includeArchived: true });
      if (!trips.ok) return null;
      return trips.data.find((t) => t.name === 'alps-full')?.id ?? null;
    });
    expect(tripId).not.toBeNull();

    const csv = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.exporting.options({
        scope: { kind: 'trips', tripIds: [id] },
      });
      if (!result.ok) return null;
      return result.data.find((option) => option.format === 'csv') ?? null;
    }, tripId as string);

    expect(csv?.losses.join(' ')).toMatch(/CSV holds waypoints only/);
    expect(csv?.omitted.routes).toBeGreaterThan(0);
  });

  test('does not offer TCX or FIT, and says why', async () => {
    const { page } = harness;

    const tripId = await page.evaluate(async () => {
      const trips = await window.trailrt.trips.list({ includeArchived: true });
      return trips.ok ? (trips.data[0]?.id ?? null) : null;
    });

    const formats = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.exporting.options({
        scope: { kind: 'trips', tripIds: [id] },
      });
      return result.ok ? result.data.map((option) => option.format) : [];
    }, tripId as string);

    expect(formats).not.toContain('tcx');
    expect(formats).not.toContain('fit');
    expect(formats).toContain('gpx');
  });

  test('refuses an unwritable format at the boundary', async () => {
    const { page } = harness;

    const refused = await page.evaluate(async () => {
      const trips = await window.trailrt.trips.list({ includeArchived: true });
      if (!trips.ok) return null;
      const id = trips.data[0]?.id;
      if (id === undefined) return null;
      const result = await window.trailrt.exporting.run({
        scope: { kind: 'trips', tripIds: [id] },
        // Deliberately a format the schema rejects.
        format: 'tcx' as never,
      });
      return result.ok ? null : result.error.message;
    });

    expect(refused).not.toBeNull();
  });
});

test.describe('unsupported formats', () => {
  test('explains GDB rather than failing obscurely', async () => {
    const { page } = harness;
    const gdb = join(scratch, 'from-basecamp.gdb');
    writeFileSync(gdb, 'not really a gdb');

    await stubOpenDialog([gdb]);
    await startImport(page);

    await expect(page.getByText(/proprietary binary format/)).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Export your data as GPX/)).toBeVisible();
    await clickAndReplaceModal(page, 'Cancel import');
  });
});

test.describe('persistence', () => {
  test('tracks and their geometry survive a restart', async () => {
    const before = await harness.page.evaluate(async () => {
      const result = await window.trailrt.tracks.listAll();
      if (!result.ok) return null;
      return result.data
        .map((track) => [track.name, track.pointCount, track.distanceM])
        .toSorted();
    });
    expect(before).not.toBeNull();
    expect((before ?? []).length).toBeGreaterThan(0);

    await close(harness);
    // Same user data directory: this is a restart, not a fresh install.
    harness = await launch(userDataDir);

    const after = await harness.page.evaluate(async () => {
      const result = await window.trailrt.tracks.listAll();
      if (!result.ok) return null;
      return result.data
        .map((track) => [track.name, track.pointCount, track.distanceM])
        .toSorted();
    });

    expect(after).toEqual(before);
  });

  test('the retained original file survives a restart too', async () => {
    const { page } = harness;

    const retained = await page.evaluate(async () => {
      const list = await window.trailrt.tracks.listAll();
      if (!list.ok) return null;
      const id = list.data[0]?.id;
      if (id === undefined) return null;
      const result = await window.trailrt.tracks.hasOriginal({ id });
      return result.ok ? result.data : null;
    });

    // The import kept the source bytes, which is what makes a destructive edit
    // recoverable.
    expect(retained?.hasOriginal).toBe(true);
    expect(retained?.format).toBe('gpx');
  });
});
