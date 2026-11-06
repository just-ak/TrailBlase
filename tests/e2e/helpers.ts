import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';

/**
 * Launch helper for the Electron end-to-end tests.
 *
 * Every launch gets its own application support directory via
 * TRAILRT_USER_DATA, so the tests never touch a real user's collection and
 * cannot interfere with each other. Requirement 13.4.
 */

export interface Harness {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
}

export function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'trailrt-e2e-'));
}

export async function launch(userDataDir: string): Promise<Harness> {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      TRAILRT_USER_DATA: userDataDir,
      NODE_ENV: 'production',
    },
  });

  const page = await app.firstWindow();
  // The app renders a loading state until settings arrive, so wait for the
  // real workspace rather than merely a painted window.
  await page.waitForSelector('[role="tree"]', { timeout: 30_000 });
  return { app, page, userDataDir };
}

export async function close(harness: Harness): Promise<void> {
  await harness.app.close();
}

export function cleanup(userDataDir: string): void {
  rmSync(userDataDir, { recursive: true, force: true });
}

/** Creates a trip through the library context menu, as a user would. */
export async function createTripViaUi(page: Page, name: string): Promise<void> {
  await page.getByRole('treeitem', { name: /^Trips/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New Trip' }).click();

  // Creation drops straight into an inline rename with the text selected.
  const input = page.locator('[role="treeitem"] input');
  await input.waitFor({ state: 'visible', timeout: 10_000 });
  await input.fill(name);
  await input.press('Enter');
  await page.getByRole('treeitem', { name: new RegExp(name) }).waitFor();
}
