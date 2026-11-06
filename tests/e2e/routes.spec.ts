import { expect, test, type Page } from '@playwright/test';
import {
  cleanup,
  close,
  createTripViaUi,
  launch,
  makeUserDataDir,
  type Harness,
} from './helpers';

/**
 * Phase 2 acceptance criteria, exercised against the built application:
 *
 *   1. a route can be created on the map
 *   2. routes save and reopen
 *   3. waypoints persist
 *   4. route geometry is preserved exactly
 */

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await createTripViaUi(harness.page, 'Phase Two Trip');
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

/** Clicks the map at an offset from its top-left corner. */
async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  if (box === null) throw new Error('map has no bounding box');
  await page.mouse.click(box.x + x, box.y + y);
}

async function selectedTripId(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const result = await window.trailrt.trips.list({});
    if (!result.ok) return null;
    return result.data[0]?.id ?? null;
  });
  if (id === null) throw new Error('no trip to work with');
  return id;
}

test.describe('route drawing', () => {
  test('draws a route by clicking the map and persists it', async () => {
    const { page } = harness;

    // Select the trip, then start drawing from its context menu.
    await page.getByRole('treeitem', { name: 'Phase Two Trip' }).click();
    await page
      .getByRole('treeitem', { name: 'Phase Two Trip' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Route' }).click();

    /*
     * The hint bar must be explicit that nothing is snapped to a road.
     *
     * With no routing service configured — which is the default and the state
     * these tests run in — the wording names the reason rather than merely
     * stating the fact. Phase 4 added the snap toggle, and it is deliberately
     * absent here: a control that cannot work must not be shown.
     */
    await expect(
      page.getByText(/no routing service configured/i),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /snap to roads/i }),
    ).toHaveCount(0);

    await clickMap(page, 240, 200);
    await clickMap(page, 330, 260);
    await clickMap(page, 420, 220);

    await expect(page.getByText(/3 points/)).toBeVisible();

    // Enter finishes and saves.
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Route saved with 3 points/)).toBeVisible();

    const route = await page.evaluate(async () => {
      const list = await window.trailrt.routes.listAll();
      if (!list.ok || list.data[0] === undefined) return null;
      const full = await window.trailrt.routes.get({ id: list.data[0].id });
      return full.ok ? full.data : null;
    });

    expect(route?.points).toHaveLength(3);
    expect(route?.pointCount).toBe(3);
    expect(route?.distanceM).toBeGreaterThan(0);
    // No elevation was supplied, so it must be absent rather than zero.
    expect(route?.elevGainM).toBeNull();
  });

  test('Escape cancels without saving a partial route', async () => {
    const { page } = harness;

    const before = await page.evaluate(async () => {
      const r = await window.trailrt.routes.listAll();
      return r.ok ? r.data.length : -1;
    });

    await page.getByRole('treeitem', { name: 'Phase Two Trip' }).click();
    await page
      .getByRole('treeitem', { name: 'Phase Two Trip' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Route' }).click();

    await clickMap(page, 260, 300);
    await clickMap(page, 300, 330);
    await page.keyboard.press('Escape');

    await expect(page.getByText(/nothing was saved/i)).toBeVisible();

    const after = await page.evaluate(async () => {
      const r = await window.trailrt.routes.listAll();
      return r.ok ? r.data.length : -1;
    });
    expect(after).toBe(before);
  });

  test('shows the route in the library under its trip and in the Routes view', async () => {
    const { page } = harness;

    // Routes are children of their trip, so the trip has to be expanded.
    await page
      .getByRole('treeitem', { name: 'Phase Two Trip' })
      .dblclick();
    await expect(
      page.getByRole('treeitem', { name: 'New Route' }).first(),
    ).toBeVisible();

    // The cross-trip view lists the same route, annotated with its trip.
    await page.getByRole('treeitem', { name: 'Routes', exact: true }).dblclick();
    const rows = page.getByRole('treeitem', { name: 'New Route' });
    await expect(rows.first()).toBeVisible();
    // Once under the trip, once in the view — distinct tree positions for the
    // same object.
    expect(await rows.count()).toBeGreaterThanOrEqual(2);
  });
});

test.describe('route geometry and statistics', () => {
  test('preserves geometry exactly through a write and read', async () => {
    const { page } = harness;
    const tripId = await selectedTripId(page);

    const points = [
      { lat: 46.1234567, lon: 8.7654321, ele: 1500.5 },
      { lat: 46.2, lon: 8.8, ele: null },
      { lat: 46.3, lon: 8.9, ele: 2100 },
    ];

    const result = await page.evaluate(
      async ({ tripId: id, points: pts }) => {
        const created = await window.trailrt.routes.create({
          tripId: id,
          name: 'Precision',
          points: pts,
        });
        if (!created.ok) return null;
        const read = await window.trailrt.routes.get({ id: created.data.id });
        return read.ok ? read.data : null;
      },
      { tripId, points },
    );

    // Exact round trip: no rounding, no re-sampling, nulls preserved.
    expect(result?.points.map((p) => p.lat)).toEqual(points.map((p) => p.lat));
    expect(result?.points.map((p) => p.lon)).toEqual(points.map((p) => p.lon));
    expect(result?.points.map((p) => p.ele)).toEqual([1500.5, null, 2100]);
    // Points with no elevation are skipped, so the gain is 2100 - 1500.5.
    expect(result?.elevGainM).toBeCloseTo(599.5, 6);
  });

  test('recomputes statistics when geometry changes', async () => {
    const { page } = harness;
    const tripId = await selectedTripId(page);

    const stats = await page.evaluate(async (id: string) => {
      const created = await window.trailrt.routes.create({
        tripId: id,
        name: 'Stats',
        points: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
        ],
      });
      if (!created.ok) return null;
      const before = created.data.distanceM;

      const updated = await window.trailrt.routes.setGeometry({
        id: created.data.id,
        points: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 2 },
        ],
      });
      return updated.ok ? { before, after: updated.data.distanceM } : null;
    }, tripId);

    expect(stats?.after).toBeGreaterThan(stats!.before!);
  });

  test('reverses a route', async () => {
    const { page } = harness;
    const tripId = await selectedTripId(page);

    const result = await page.evaluate(async (id: string) => {
      const created = await window.trailrt.routes.create({
        tripId: id,
        name: 'Reversible',
        points: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 0, lon: 2 },
        ],
      });
      if (!created.ok) return null;
      await window.trailrt.routes.reverse({ id: created.data.id });
      const read = await window.trailrt.routes.get({ id: created.data.id });
      return read.ok ? read.data.points.map((p) => p.lon) : null;
    }, tripId);

    expect(result).toEqual([2, 1, 0]);
  });
});

test.describe('waypoints', () => {
  test('creates a waypoint by map click and shows a marker', async () => {
    const { page } = harness;

    await page.getByRole('treeitem', { name: 'Phase Two Trip' }).click();
    await page
      .getByRole('treeitem', { name: 'Phase Two Trip' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Waypoint' }).click();

    await expect(page.getByText(/Click the map to place a waypoint/i)).toBeVisible();
    await clickMap(page, 300, 240);

    await expect(page.locator('.trailrt-waypoint-marker').first()).toBeVisible();
    // The properties panel switches to the new waypoint.
    await expect(page.getByLabel('Latitude')).toBeVisible();
  });

  test('rejects an out-of-range coordinate with an explanation', async () => {
    const { page } = harness;
    const latField = page.getByLabel('Latitude');
    await latField.fill('999');
    await latField.blur();

    await expect(page.getByText(/Latitude must be a number between/i)).toBeVisible();
    // The field reverts rather than persisting nonsense.
    await expect(latField).not.toHaveValue('999');
  });

  test('stores an empty elevation as unknown, not zero', async () => {
    const { page } = harness;
    const result = await page.evaluate(async () => {
      const list = await window.trailrt.waypoints.listAll();
      const first = list.ok ? list.data[0] : undefined;
      if (first === undefined) return null;
      const updated = await window.trailrt.waypoints.update({
        id: first.id,
        eleM: null,
      });
      return updated.ok ? updated.data.eleM : 'error';
    });
    expect(result).toBeNull();
  });

  test('persists waypoints across a restart', async () => {
    const dir = makeUserDataDir();
    let session = await launch(dir);
    try {
      await createTripViaUi(session.page, 'Restart Trip');
      const tripId = await selectedTripId(session.page);

      await session.page.evaluate(async (id: string) => {
        await window.trailrt.waypoints.create({
          tripId: id,
          name: 'Survivor',
          lat: 46.5,
          lon: 8.5,
          eleM: 1234,
          symbol: 'summit',
        });
      }, tripId);

      await close(session);
      session = await launch(dir);

      const restored = await session.page.evaluate(async () => {
        const r = await window.trailrt.waypoints.listAll();
        return r.ok ? r.data : [];
      });

      expect(restored).toHaveLength(1);
      expect(restored[0]).toMatchObject({
        name: 'Survivor',
        eleM: 1234,
        symbol: 'summit',
      });
    } finally {
      await close(session).catch(() => {});
      cleanup(dir);
    }
  });
});

test.describe('undo and redo', () => {
  test('undoes and redoes a geometry edit', async () => {
    const dir = makeUserDataDir();
    const session = await launch(dir);
    try {
      await createTripViaUi(session.page, 'Undo Trip');
      const tripId = await selectedTripId(session.page);

      const routeId = await session.page.evaluate(async (id: string) => {
        const created = await window.trailrt.routes.create({
          tripId: id,
          name: 'Editable',
          points: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
          ],
        });
        return created.ok ? created.data.id : null;
      }, tripId);
      expect(routeId).not.toBeNull();

      await session.page.evaluate(async (id: string) => {
        await window.trailrt.routes.setGeometry({
          id,
          points: [{ lat: 5, lon: 5 }],
        });
      }, routeId!);

      const state = await session.page.evaluate(async () => {
        const r = await window.trailrt.undo.state();
        return r.ok ? r.data : null;
      });
      expect(state?.canUndo).toBe(true);
      expect(state?.undoLabel).toBe('route edit');

      // Undo restores the exact previous array.
      const afterUndo = await session.page.evaluate(async (id: string) => {
        await window.trailrt.undo.undo();
        const read = await window.trailrt.routes.get({ id });
        return read.ok ? read.data.points.map((p) => p.lon) : null;
      }, routeId!);
      expect(afterUndo).toEqual([0, 1]);

      const afterRedo = await session.page.evaluate(async (id: string) => {
        await window.trailrt.undo.redo();
        const read = await window.trailrt.routes.get({ id });
        return read.ok ? read.data.points.map((p) => p.lat) : null;
      }, routeId!);
      expect(afterRedo).toEqual([5]);
    } finally {
      await close(session);
      cleanup(dir);
    }
  });

  test('undoes a deletion, restoring the original id', async () => {
    const dir = makeUserDataDir();
    const session = await launch(dir);
    try {
      await createTripViaUi(session.page, 'Delete Trip');
      const tripId = await selectedTripId(session.page);

      const result = await session.page.evaluate(async (id: string) => {
        const created = await window.trailrt.waypoints.create({
          tripId: id,
          name: 'Doomed',
          lat: 1,
          lon: 1,
          eleM: 500,
        });
        if (!created.ok) return null;
        const originalId = created.data.id;

        await window.trailrt.waypoints.delete({ id: originalId });
        const gone = await window.trailrt.waypoints.get({ id: originalId });

        await window.trailrt.undo.undo();
        const back = await window.trailrt.waypoints.get({ id: originalId });

        return {
          wasDeleted: !gone.ok,
          restored: back.ok ? back.data : null,
          originalId,
        };
      }, tripId);

      expect(result?.wasDeleted).toBe(true);
      // Reusing the id keeps selection and future references valid.
      expect(result?.restored?.id).toBe(result?.originalId);
      expect(result?.restored).toMatchObject({ name: 'Doomed', eleM: 500 });
    } finally {
      await close(session);
      cleanup(dir);
    }
  });

  test('does not offer undo for a trip deletion', async () => {
    const dir = makeUserDataDir();
    const session = await launch(dir);
    try {
      const state = await session.page.evaluate(async () => {
        const trip = await window.trailrt.trips.create({ name: 'Ephemeral' });
        if (!trip.ok) return null;
        await window.trailrt.trips.delete({ id: trip.data.id });
        const r = await window.trailrt.undo.state();
        return r.ok ? r.data : null;
      });
      // ADR 0001: the cascade spans tables, so it is confirmation-gated
      // instead of undoable.
      expect(state?.canUndo).toBe(false);
    } finally {
      await close(session);
      cleanup(dir);
    }
  });
});
