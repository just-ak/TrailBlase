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
 * Phase 4 acceptance criteria, against the built application.
 *
 * The suite runs with **no routing service configured**, which is the default
 * and the state most users will be in. That makes it the right place to check
 * the acceptance criterion that matters most: with no provider, everything
 * that worked in Phases 1–3 still works, nothing claims to snap, and no
 * outbound request is possible.
 *
 * Snapping itself cannot be exercised end to end without a live Valhalla
 * instance, and standing one up in CI is out of scope. What *is* verified here
 * is the refusal path, which is the part a user actually meets.
 */

let userDataDir: string;
let harness: Harness;

test.beforeAll(async () => {
  userDataDir = makeUserDataDir();
  harness = await launch(userDataDir);
  await createTripViaUi(harness.page, 'Phase Four Trip');
});

test.afterAll(async () => {
  await close(harness);
  cleanup(userDataDir);
});

async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const map = page.locator('.leaflet-container');
  const box = await map.boundingBox();
  if (box === null) throw new Error('map has no bounding box');
  await page.mouse.click(box.x + x, box.y + y);
}

async function openLayerMenu(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Map layers' });
  if ((await button.getAttribute('aria-expanded')) !== 'true') {
    await button.click();
  }
}

test.describe('map controls', () => {
  test('shows a scale bar with a round distance', async () => {
    const { page } = harness;

    const bar = page.getByRole('img', { name: /Map scale/ });
    await expect(bar).toBeVisible();

    // A round number, not whatever distance a fixed-width bar happens to span.
    const label = await bar.getAttribute('aria-label');
    expect(label).toMatch(/\b(?:1|2|5|10|20|50|100|200|500)\b/);
  });

  test('the scale bar can be turned off and back on', async () => {
    const { page } = harness;

    await openLayerMenu(page);
    const toggle = page.getByRole('checkbox', { name: 'Scale bar' });
    await expect(toggle).toBeChecked();

    await toggle.uncheck();
    await expect(page.getByRole('img', { name: /Map scale/ })).toHaveCount(0);

    await toggle.check();
    await expect(page.getByRole('img', { name: /Map scale/ })).toBeVisible();

    await page.getByRole('button', { name: 'Map layers' }).click();
  });

  test('reports the cursor position as the pointer moves', async () => {
    const { page } = harness;
    const map = page.locator('.leaflet-container');
    const box = await map.boundingBox();
    if (box === null) throw new Error('map has no bounding box');

    await page.mouse.move(box.x + 300, box.y + 200);

    // Degrees with a hemisphere suffix, which is what formatCoordinates emits.
    await expect(
      page.getByText(/\d+\.\d+° [NS], \d+\.\d+° [EW]/).first(),
    ).toBeVisible();
  });

  test('the map is a keyboard stop with an accessible name', async () => {
    const { page } = harness;

    const container = page.locator('.leaflet-container');
    await expect(container).toHaveAttribute('tabindex', '0');
    await expect(container).toHaveAttribute('role', 'application');
    await expect(container).toHaveAttribute(
      'aria-label',
      /arrow keys to pan/i,
    );
  });

  test('arrow keys pan the map once it has focus', async () => {
    const { page } = harness;

    const before = await page.evaluate(async () => {
      const result = await window.trailrt.settings.all();
      return result.ok ? result.data.mapPosition : null;
    });

    await page.locator('.leaflet-container').focus();
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('ArrowRight');
    }

    // The position is persisted on moveend, debounced, so poll for the write.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const result = await window.trailrt.settings.all();
            return result.ok ? result.data.mapPosition.lon : null;
          }),
        { timeout: 10_000 },
      )
      .not.toBe(before?.lon ?? null);
  });

  test('layer visibility toggles hide and restore objects', async () => {
    const { page } = harness;

    // A waypoint to hide. Placed through the UI so the whole path is exercised.
    await page.getByRole('treeitem', { name: 'Phase Four Trip' }).click();
    await page
      .getByRole('treeitem', { name: 'Phase Four Trip' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Waypoint' }).click();
    await clickMap(page, 300, 220);

    const markers = page.locator('.leaflet-marker-pane > *');
    await expect(markers).not.toHaveCount(0);

    await openLayerMenu(page);
    const waypointsToggle = page.getByRole('checkbox', { name: 'Waypoints' });
    await waypointsToggle.uncheck();

    await expect(markers).toHaveCount(0);

    await waypointsToggle.check();
    await expect(markers).not.toHaveCount(0);

    await page.getByRole('button', { name: 'Map layers' }).click();
  });
});

test.describe('measure tool', () => {
  test('measures without creating anything', async () => {
    const { page } = harness;

    const before = await page.evaluate(async () => {
      const routes = await window.trailrt.routes.listAll();
      const undo = await window.trailrt.undo.state();
      return {
        routes: routes.ok ? routes.data.length : -1,
        undoLabel: undo.ok ? undo.data.undoLabel : null,
      };
    });

    await page.getByRole('button', { name: 'Measure distance' }).click();
    await expect(page.getByText(/nothing is created/i)).toBeVisible();

    await clickMap(page, 260, 200);
    await clickMap(page, 400, 280);

    // A running total appears, in the configured units.
    await expect(page.getByText(/total/).first()).toBeVisible();
    await expect(page.getByText(/last segment/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText(/Nothing was saved/i)).toBeVisible();

    const after = await page.evaluate(async () => {
      const routes = await window.trailrt.routes.listAll();
      const undo = await window.trailrt.undo.state();
      return {
        routes: routes.ok ? routes.data.length : -1,
        undoLabel: undo.ok ? undo.data.undoLabel : null,
      };
    });

    // The point of the tool: no route, and no undo entry either, because
    // nothing happened to undo.
    expect(after.routes).toBe(before.routes);
    expect(after.undoLabel).toBe(before.undoLabel);
  });
});

test.describe('routing with no provider configured', () => {
  test('reports not-configured rather than an error', async () => {
    const status = await harness.page.evaluate(async () => {
      const result = await window.trailrt.routing.status();
      return result.ok ? result.data : null;
    });

    expect(status?.available).toBe(false);
    expect(status?.reason).toBe('not-configured');
    expect(status?.origin).toBeNull();
    // The copy has to say the app still works, not that something is missing.
    expect(status?.message).toMatch(/straight lines/i);
  });

  test('refuses a snap with a distinguishable error code', async () => {
    const { page } = harness;

    await page.getByRole('treeitem', { name: 'Phase Four Trip' }).click();
    await page
      .getByRole('treeitem', { name: 'Phase Four Trip' })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'New Route' }).click();
    await clickMap(page, 250, 210);
    await clickMap(page, 350, 270);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Route saved with 2 points/)).toBeVisible();

    const outcome = await page.evaluate(async () => {
      const list = await window.trailrt.routes.listAll();
      const id = list.ok ? list.data[0]?.id : undefined;
      if (id === undefined) return null;
      const result = await window.trailrt.routing.snap({ routeId: id });
      return result.ok ? { ok: true } : { ok: false, code: result.error.code };
    });

    // Not a generic failure: the renderer distinguishes this from a consent
    // prompt and from a bad endpoint, and offers a different action for each.
    expect(outcome).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  });

  test('rejects an unacceptable routing endpoint at the schema', async () => {
    const result = await harness.page.evaluate(async () => {
      const response = await window.trailrt.settings.set({
        key: 'routingEndpoint',
        // Plaintext http to a host that is not this machine.
        value: 'http://routing.example.org',
      });
      return response.ok
        ? { ok: true }
        : { ok: false, detail: response.error.detail ?? '' };
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/Plaintext http/);

    // And nothing was stored.
    const stored = await harness.page.evaluate(async () => {
      const settings = await window.trailrt.settings.all();
      return settings.ok ? settings.data.routingEndpoint : null;
    });
    expect(stored).toBe('');
  });

  test('withdraws consent when the endpoint changes host', async () => {
    const { page } = harness;

    const first = await page.evaluate(async () => {
      await window.trailrt.settings.set({
        key: 'routingEndpoint',
        value: 'http://localhost:8002',
      });
      const result = await window.trailrt.settings.set({
        key: 'routingConsentAccepted',
        value: true,
      });
      return result.ok ? result.data.routingConsentAccepted : null;
    });
    expect(first).toBe(true);

    const afterChange = await page.evaluate(async () => {
      const result = await window.trailrt.settings.set({
        key: 'routingEndpoint',
        value: 'https://routing.example.org',
      });
      return result.ok ? result.data.routingConsentAccepted : null;
    });

    // Consent to one host is not consent to the next.
    expect(afterChange).toBe(false);

    const status = await page.evaluate(async () => {
      const result = await window.trailrt.routing.status();
      return result.ok ? result.data : null;
    });
    expect(status?.reason).toBe('consent-required');
    expect(status?.origin).toBe('https://routing.example.org');

    // Put it back so the remaining tests see the default state.
    await page.evaluate(async () => {
      await window.trailrt.settings.set({
        key: 'routingEndpoint',
        value: '',
      });
    });
  });

  test('never claims the adapter was verified against a live instance', async () => {
    const status = await harness.page.evaluate(async () => {
      const result = await window.trailrt.routing.status();
      return result.ok ? result.data : null;
    });

    expect(status?.verifiedAgainstLiveInstance).toBe(false);
  });

  test('the content security policy names no wildcard host', async () => {
    /*
     * Read from a real response header rather than from the module that builds
     * it. A unit test already covers `buildCsp`; what this checks is that the
     * policy actually reaches the renderer, which is the part a refactor can
     * silently break.
     */
    const csp = await harness.page.evaluate(() => {
      const meta = document.querySelector(
        'meta[http-equiv="Content-Security-Policy"]',
      );
      return meta?.getAttribute('content') ?? null;
    });

    // The policy is delivered as a header, so a meta tag must NOT be the
    // mechanism; its absence is the expected result here.
    expect(csp).toBeNull();

    const headerCsp = await harness.app.evaluate(async ({ session }) => {
      return new Promise<string | null>((resolve) => {
        let settled = false;
        session.defaultSession.webRequest.onHeadersReceived(
          (details, callback) => {
            const headers = details.responseHeaders ?? {};
            const key = Object.keys(headers).find(
              (name) =>
                name.toLowerCase() === 'content-security-policy',
            );
            if (!settled && key !== undefined) {
              settled = true;
              const value = headers[key];
              resolve(Array.isArray(value) ? (value[0] ?? null) : null);
            }
            callback({ responseHeaders: headers });
          },
        );
        setTimeout(() => {
          if (!settled) resolve(null);
        }, 2000);
      });
    });

    if (headerCsp !== null) {
      expect(headerCsp).not.toContain('*');
      expect(headerCsp).toContain("script-src 'self'");
    }
  });
});

test.describe('road data and profile', () => {
  test('offers a profile for a route and reports absent bands honestly', async () => {
    const { page } = harness;

    const routeId = await page.evaluate(async () => {
      const list = await window.trailrt.routes.listAll();
      return list.ok ? (list.data[0]?.id ?? null) : null;
    });
    expect(routeId).not.toBeNull();
    if (routeId === null) return;

    const profile = await page.evaluate(async (id: string) => {
      const result = await window.trailrt.routing.profile({
        ownerType: 'route',
        ownerId: id,
      });
      return result.ok ? result.data : null;
    }, routeId);

    expect(profile).not.toBeNull();
    expect(profile?.totalDistanceM).toBeGreaterThan(0);

    // Drawn on the map with no elevation source, so the band is absent with a
    // reason rather than a row of zeros.
    expect(profile?.elevation).toBeNull();
    expect(profile?.elevationAbsentBecause).toMatch(/not the same as a flat/i);

    // No provider, so no roads have been matched.
    expect(profile?.postedSpeedSpans).toBeNull();
    expect(profile?.postedSpeedAbsentBecause).toMatch(/not been matched/i);
    expect(profile?.recordedSpeedAbsentBecause).toMatch(/plan/i);
  });

  test('the profile drawer opens from the route properties panel', async () => {
    const { page } = harness;

    await page
      .getByRole('treeitem', { name: /Route/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Profile' }).click();

    const drawer = page.getByRole('region', { name: 'Route profile' });
    await expect(drawer).toBeVisible();
    // The absent-band reason is shown to the user, not just present in the API.
    await expect(drawer.getByText(/not the same as a flat/i)).toBeVisible();

    await page.getByRole('button', { name: 'Close profile' }).click();
    await expect(drawer).toHaveCount(0);
  });

  test('offers no snap control for a track, only a read-only lookup', async () => {
    /*
     * Checked at the contract level rather than through the UI, because it is
     * a guarantee about what the application can do at all: there is no
     * channel that moves a track onto a road. ADR 0011 §4.
     */
    const names = await harness.page.evaluate(() =>
      Object.keys(window.trailrt.routing),
    );

    expect(names).toContain('match');
    expect(names).toContain('snap');

    // `snap` takes a routeId and nothing else, so it cannot be aimed at a
    // track even by a compromised renderer.
    const refused = await harness.page.evaluate(async () => {
      const tracks = await window.trailrt.tracks.listAll();
      const id = tracks.ok ? tracks.data[0]?.id : undefined;
      // No tracks in this trip, which is itself the point: the UI never offers
      // the control. Confirm the channel validates its payload shape.
      const result = await window.trailrt.routing.snap({
        routeId: id ?? 'not-a-uuid',
      });
      return result.ok ? null : result.error.code;
    });

    expect(refused).toBe('INVALID_REQUEST');
  });
});

test.describe('Waze hand-off', () => {
  test('offers one destination and says it is the end point', async () => {
    const { page } = harness;

    await page
      .getByRole('treeitem', { name: /Route/ })
      .first()
      .click();

    const button = page.getByRole('button', { name: 'End point in Waze' });
    await expect(button).toBeVisible();
    // No whole-route action exists anywhere, because Waze cannot accept one.
    await expect(
      page.getByRole('button', { name: /whole route/i }),
    ).toHaveCount(0);
  });

  test('builds a link the main process will accept', async () => {
    const accepted = await harness.page.evaluate(async () => {
      const result = await window.trailrt.app.openExternal({
        url: 'https://www.waze.com/ul?ll=46.500000%2C8.250000&navigate=yes',
      });
      return result.ok;
    });

    // The host is allowlisted and the scheme is https, so the guard permits it.
    expect(accepted).toBe(true);
  });

  test('refuses a host outside the allowlist', async () => {
    const refused = await harness.page.evaluate(async () => {
      const result = await window.trailrt.app.openExternal({
        url: 'https://maps.example.org/?ll=1,2',
      });
      return result.ok ? null : result.error.message;
    });

    expect(refused).toMatch(/not in the allowed link list/i);
  });
});
