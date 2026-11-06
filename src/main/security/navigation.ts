import { shell, type BrowserWindow } from 'electron';
import { ServiceError } from '../services/errors';

/**
 * Navigation and external-link containment.
 *
 * The renderer is an application, not a browser. It has no business navigating
 * anywhere, and nothing should be able to open a second window.
 */

/**
 * Hosts the app may hand to the system browser. Deliberately short: these are
 * the only destinations any UI affordance offers.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'github.com',
  'www.openstreetmap.org',
  'openstreetmap.org',
  'www.gnu.org',
  'waze.com',
  'www.waze.com',
]);

export interface ExternalUrlCheck {
  allowed: boolean;
  reason?: string;
}

export function checkExternalUrl(raw: string): ExternalUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allowed: false, reason: 'That link is not a valid URL.' };
  }

  // https only. http downgrades, and file:/ javascript: are attack surface.
  if (url.protocol !== 'https:') {
    return {
      allowed: false,
      reason: `Only https links can be opened (got "${url.protocol}").`,
    };
  }

  if (!ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) {
    return {
      allowed: false,
      reason: `"${url.hostname}" is not in the allowed link list.`,
    };
  }

  return { allowed: true };
}

/**
 * Opens a validated URL in the system browser, never in an app window.
 *
 * Throws a `ServiceError` rather than a plain `Error` so the reason survives
 * the IPC boundary. `toErrorShape` maps an unrecognised `Error` to
 * `UNKNOWN: "Something went wrong."` and tucks the real text into `detail`,
 * which meant a blocked host produced a message the user could do nothing
 * with. The refusal is a request problem and says which host was refused.
 */
export async function openExternal(raw: string): Promise<void> {
  const check = checkExternalUrl(raw);
  if (!check.allowed) {
    throw new ServiceError(
      'INVALID_REQUEST',
      check.reason ?? 'That link cannot be opened.',
    );
  }
  await shell.openExternal(raw);
}

/**
 * Applies the guards to a window.
 *
 * `rendererOrigin` is the only origin the window may occupy: the dev server in
 * development, or the packaged file URL in production.
 */
export function installNavigationGuards(
  window: BrowserWindow,
  rendererUrl: string,
): void {
  // No new windows, ever. Anything that wants to open a link goes through the
  // validated IPC path instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url).catch(() => {
      // A denied link is not an error worth surfacing; the UI should not be
      // offering it in the first place.
    });
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isSameDocument(url, rendererUrl)) {
      event.preventDefault();
    }
  });

  // Covers the in-page equivalent that will-navigate does not catch.
  window.webContents.on('will-frame-navigate', (event) => {
    if (!isSameDocument(event.url, rendererUrl)) {
      event.preventDefault();
    }
  });

  // No webviews and no renderer-controlled preload injection.
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

function isSameDocument(candidate: string, rendererUrl: string): boolean {
  try {
    const a = new URL(candidate);
    const b = new URL(rendererUrl);
    if (a.protocol === 'file:' && b.protocol === 'file:') {
      return a.pathname === b.pathname;
    }
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

export { ALLOWED_EXTERNAL_HOSTS };
