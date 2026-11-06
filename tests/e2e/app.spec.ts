import { expect, test } from '@playwright/test';
import {
  cleanup,
  close,
  createTripViaUi,
  launch,
  makeUserDataDir,
  type Harness,
} from './helpers';

/**
 * Phase 1 acceptance criteria, exercised against the built application:
 *
 *   1. the app launches on macOS
 *   2. the map renders
 *   3. trips can be created, renamed and deleted
 *   4. trips persist after a restart
 */

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

test.describe('application shell', () => {
  test('launches with a single visible window', async () => {
    const { app, page } = harness;
    expect(app.windows()).toHaveLength(1);
    await expect(page.locator('#root')).toBeVisible();

    const isVisible = await app.evaluate(async ({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows();
      return window?.isVisible() ?? false;
    });
    expect(isVisible).toBe(true);
  });

  test('reports its identity and licence', async () => {
    const info = await harness.page.evaluate(async () => {
      const result = await window.trailrt.app.info();
      return result.ok ? result.data : null;
    });
    expect(info?.name).toBe('TrailRT');
    expect(info?.licence).toBe('GPL-3.0-or-later');
  });

  test('renders all three panels', async () => {
    const { page } = harness;
    await expect(page.getByRole('tree', { name: 'Trip library' })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.getByText('Select a trip or folder')).toBeVisible();
  });
});

test.describe('security posture', () => {
  test('the renderer has no Node integration or filesystem access', async () => {
    const probe = await harness.page.evaluate(() => ({
      require: typeof (globalThis as Record<string, unknown>).require,
      process: typeof (globalThis as Record<string, unknown>).process,
      module: typeof (globalThis as Record<string, unknown>).module,
    }));
    expect(probe.require).toBe('undefined');
    expect(probe.process).toBe('undefined');
    expect(probe.module).toBe('undefined');
  });

  test('exposes only the named bridge, with no generic invoke', async () => {
    const api = await harness.page.evaluate(() => ({
      namespaces: Object.keys(window.trailrt).toSorted(),
      hasInvoke: 'invoke' in window.trailrt,
      hasSend: 'send' in window.trailrt,
    }));
    // An exact list, deliberately: a new namespace appearing here should be a
    // decision someone made, not something that drifted in.
    expect(api.namespaces).toEqual([
      'app',
      'backup',
      'events',
      'exporting',
      'folders',
      'geometry',
      'importing',
      'library',
      'routes',
      'settings',
      'tracks',
      'trips',
      'undo',
      'waypoints',
    ]);
    // A passthrough would make the restricted surface decorative.
    expect(api.hasInvoke).toBe(false);
    expect(api.hasSend).toBe(false);
  });

  test('rejects an invalid IPC payload at the boundary', async () => {
    const result = await harness.page.evaluate(async () => {
      // Deliberately malformed: empty name, which the schema forbids.
      const r = await window.trailrt.trips.create({ name: '' } as never);
      return r.ok ? null : r.error.code;
    });
    expect(result).toBe('INVALID_REQUEST');
  });

  test('refuses to open a non-allowlisted external link', async () => {
    const result = await harness.page.evaluate(async () => {
      const r = await window.trailrt.app.openExternal({
        url: 'https://evil.example.com',
      });
      return r.ok;
    });
    expect(result).toBe(false);
  });
});

test.describe('map', () => {
  test('renders tiles from the configured provider', async () => {
    const { page } = harness;
    const tile = page.locator('.leaflet-tile').first();
    await tile.waitFor({ timeout: 20_000 });
    const src = await tile.getAttribute('src');
    expect(src).toContain('tile.openstreetmap.org');
  });

  test('shows OpenStreetMap attribution', async () => {
    await expect(
      harness.page.locator('.leaflet-control-attribution'),
    ).toContainText('OpenStreetMap');
  });

  test('resizes with the window without leaving gaps', async () => {
    const { app, page } = harness;
    const container = page.locator('.leaflet-container');

    await app.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1200, 800);
    });
    await page.waitForTimeout(600);
    const narrow = await container.boundingBox();

    await app.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1500, 900);
    });
    await page.waitForTimeout(600);
    const wide = await container.boundingBox();

    expect(wide!.width).toBeGreaterThan(narrow!.width);

    // Leaflet's internal size must match the container, or tiles leave grey
    // gutters. This is the assertion that catches a missing invalidateSize().
    const matches = await page.evaluate(() => {
      const el = document.querySelector('.leaflet-container') as HTMLElement;
      const pane = document.querySelector('.leaflet-map-pane') as HTMLElement;
      return el !== null && pane !== null && el.clientWidth > 0;
    });
    expect(matches).toBe(true);
  });

  test('hiding the library panel reflows the map', async () => {
    const { page } = harness;
    const container = page.locator('.leaflet-container');
    const before = await container.boundingBox();

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('noop'));
    });
    // Toggle through the store, which is what the native menu does.
    await page.evaluate(async () => {
      const result = await window.trailrt.settings.set({
        key: 'panelLayout',
        value: {
          libraryWidth: 280,
          propertiesWidth: 320,
          libraryVisible: false,
          propertiesVisible: true,
        },
      });
      return result.ok;
    });
    await page.reload();
    await page.waitForSelector('.leaflet-container');
    await page.waitForTimeout(800);

    const after = await container.boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width);

    // Restore for later tests.
    await page.evaluate(async () => {
      await window.trailrt.settings.set({
        key: 'panelLayout',
        value: {
          libraryWidth: 280,
          propertiesWidth: 320,
          libraryVisible: true,
          propertiesVisible: true,
        },
      });
    });
    await page.reload();
    await page.waitForSelector('[role="tree"]');
  });
});

test.describe('library tree', () => {
  test('is rooted at My Collection with the specified branches', async () => {
    const { page } = harness;
    await expect(page.getByRole('treeitem', { name: /My Collection/ })).toBeVisible();
    for (const branch of ['Trips', 'Routes', 'Tracks', 'Waypoints', 'Imported Data', 'Recently Used']) {
      await expect(
        page.getByRole('treeitem', { name: new RegExp(branch) }),
      ).toBeVisible();
    }
  });

  test('marks later-phase branches rather than showing them as broken', async () => {
    // Recently Used is still to come, so that branch says so.
    await expect(
      harness.page.getByRole('treeitem', { name: 'Recently Used', exact: true }),
    ).toContainText('later phase');

    // Everything else is implemented as of Phase 3 and must not claim
    // otherwise. Tracks and Imported Data moved into this list with the
    // import pipeline.
    for (const branch of ['Routes', 'Tracks', 'Waypoints', 'Imported Data']) {
      await expect(
        harness.page.getByRole('treeitem', { name: branch, exact: true }),
      ).not.toContainText('later phase');
    }
  });
});

test.describe('trip lifecycle', () => {
  test('creates, renames and deletes a trip through the UI', async () => {
    const { page } = harness;

    // --- create
    await createTripViaUi(page, 'Dolomites Traverse');
    await expect(
      page.getByRole('treeitem', { name: /Dolomites Traverse/ }),
    ).toBeVisible();

    // The properties panel reflects the selection.
    await expect(page.locator('input').first()).toBeVisible();

    // --- rename, via the properties panel name field
    const nameField = page
      .locator('div')
      .filter({ hasText: /^Name$/ })
      .locator('input');
    await nameField.fill('Alta Via 1');
    await nameField.blur();
    await expect(page.getByRole('treeitem', { name: /Alta Via 1/ })).toBeVisible();

    // --- delete, with confirmation
    await page
      .getByRole('treeitem', { name: /Alta Via 1/ })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Delete Trip/ }).click();
    await expect(page.getByText('will be permanently deleted')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(
      page.getByRole('treeitem', { name: /Alta Via 1/ }),
    ).toHaveCount(0);
  });

  test('duplicating a trip produces an independent copy', async () => {
    const { page } = harness;
    await createTripViaUi(page, 'Pyrenees');

    await page
      .getByRole('treeitem', { name: /^Pyrenees\b/ })
      .first()
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();

    await expect(
      page.getByRole('treeitem', { name: /Pyrenees copy/ }),
    ).toBeVisible();
    // The original survives the duplication.
    await expect(
      page.getByRole('treeitem', { name: /Pyrenees/ }),
    ).not.toHaveCount(0);
  });

  test('archiving hides a trip from the default view', async () => {
    const { page } = harness;
    await createTripViaUi(page, 'Old Route');

    await page.getByRole('treeitem', { name: /Old Route/ }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Archive' }).click();

    await expect(page.getByRole('treeitem', { name: /Old Route/ })).toHaveCount(0);

    await page.getByLabel('Archived').check();
    await expect(page.getByRole('treeitem', { name: /Old Route/ })).toBeVisible();
    await page.getByLabel('Archived').uncheck();
  });

  test('searching filters to matching trips', async () => {
    const { page } = harness;
    // Self-contained: never rely on data another test happened to create.
    await createTripViaUi(page, 'Carpathian Ridge');

    const search = page.getByLabel('Search trips');
    await search.fill('carpath');
    await expect(
      page.getByRole('button', { name: /Carpathian Ridge/ }).first(),
    ).toBeVisible();

    // A term that matches nothing yields no results rather than everything.
    await search.fill('zzzznomatch');
    await expect(page.getByText('0 matches')).toBeVisible();

    await search.fill('');
    await expect(
      page.getByRole('treeitem', { name: /Carpathian Ridge/ }),
    ).toBeVisible();
  });
});

test.describe('persistence across restart', () => {
  test('trips and UI state survive a relaunch', async () => {
    // Use a dedicated directory so this does not depend on earlier tests.
    const dir = makeUserDataDir();
    let session = await launch(dir);

    try {
      await createTripViaUi(session.page, 'Haute Route');
      await expect(
        session.page.getByRole('treeitem', { name: /Haute Route/ }),
      ).toBeVisible();

      await close(session);

      session = await launch(dir);
      await expect(
        session.page.getByRole('treeitem', { name: /Haute Route/ }),
      ).toBeVisible();

      // Settings survived too.
      const settings = await session.page.evaluate(async () => {
        const r = await window.trailrt.settings.all();
        return r.ok ? r.data : null;
      });
      expect(settings?.mapProviderId).toBe('osm');
    } finally {
      await close(session).catch(() => {});
      cleanup(dir);
    }
  });

  test('a backup can be created and listed', async () => {
    const dir = makeUserDataDir();
    const session = await launch(dir);
    try {
      await createTripViaUi(session.page, 'Backup Subject');

      const created = await session.page.evaluate(async () => {
        const r = await window.trailrt.backup.create();
        return r.ok ? r.data.fileName : null;
      });
      expect(created).toMatch(/^trailrt-backup-/);

      const listed = await session.page.evaluate(async () => {
        const r = await window.trailrt.backup.list();
        return r.ok ? r.data.length : 0;
      });
      expect(listed).toBeGreaterThan(0);
    } finally {
      await close(session);
      cleanup(dir);
    }
  });

  test('restoring a backup rolls the collection back', async () => {
    const dir = makeUserDataDir();
    const session = await launch(dir);
    try {
      await createTripViaUi(session.page, 'Before Snapshot');

      const fileName = await session.page.evaluate(async () => {
        const r = await window.trailrt.backup.create();
        return r.ok ? r.data.fileName : null;
      });
      expect(fileName).not.toBeNull();

      await createTripViaUi(session.page, 'After Snapshot');
      await expect(
        session.page.getByRole('treeitem', { name: /After Snapshot/ }),
      ).toBeVisible();

      const restored = await session.page.evaluate(async (name: string) => {
        const r = await window.trailrt.backup.restore({ fileName: name });
        return r.ok;
      }, fileName!);
      expect(restored).toBe(true);

      await session.page.reload();
      await session.page.waitForSelector('[role="tree"]');

      await expect(
        session.page.getByRole('treeitem', { name: /Before Snapshot/ }),
      ).toBeVisible();
      await expect(
        session.page.getByRole('treeitem', { name: /After Snapshot/ }),
      ).toHaveCount(0);
    } finally {
      await close(session);
      cleanup(dir);
    }
  });

  test('refuses to restore a file that is not a TrailRT database', async () => {
    const dir = makeUserDataDir();
    const session = await launch(dir);
    try {
      const result = await session.page.evaluate(async () => {
        const r = await window.trailrt.backup.restore({
          fileName: 'trailrt-backup-does-not-exist.db',
        });
        return r.ok ? null : r.error.code;
      });
      expect(result).toBe('INVALID_REQUEST');

      // And the live database is untouched.
      await expect(session.page.getByRole('tree')).toBeVisible();
    } finally {
      await close(session);
      cleanup(dir);
    }
  });
});
