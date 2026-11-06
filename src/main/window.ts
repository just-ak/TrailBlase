import { BrowserWindow, nativeTheme, screen } from 'electron';
import { EVENTS } from '@shared/ipc/channels';
import type { WindowGeometry } from '@shared/domain/types';
import { ctx } from './context';
import { installNavigationGuards } from './security/navigation';
import * as settingsService from './services/settingsService';

/**
 * The single main window.
 *
 * Geometry is persisted to settings and restored on launch, clamped to the
 * displays that actually exist — a window restored onto a monitor that has
 * since been unplugged is invisible and feels like a crash.
 */

const MIN_WIDTH = 1024;
const MIN_HEIGHT = 700;

let mainWindow: BrowserWindow | null = null;

function clampToVisibleDisplay(
  geometry: WindowGeometry,
): WindowGeometry | null {
  const matching = screen.getAllDisplays().find((display) => {
    const { x, y, width, height } = display.workArea;
    // Require the title bar to be reachable, not merely that the rect overlaps.
    return (
      geometry.x >= x - 100 &&
      geometry.x + geometry.width <= x + width + 100 &&
      geometry.y >= y - 50 &&
      geometry.y + geometry.height <= y + height + 100
    );
  });
  return matching === undefined ? null : geometry;
}

export interface WindowOptions {
  /** A dev-server URL, or an absolute path to index.html. */
  rendererTarget: string;
  preloadPath: string;
}

/**
 * Whether the target is a URL to load or a file to read.
 *
 * This must be decided by the target itself, not by whether the build is
 * packaged. An unpackaged run with no dev server — which is exactly how the
 * end-to-end tests launch the app — has a file path while `isPackaged` is
 * false, and calling `loadURL` on a bare path silently fails to load anything.
 */
function isUrlTarget(target: string): boolean {
  return /^https?:\/\//.test(target);
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const { rendererTarget, preloadPath } = options;
  const settings = settingsService.all(ctx().handle.db);
  const saved = settings.windowGeometry;
  const restored = saved === null ? null : clampToVisibleDisplay(saved);

  const window = new BrowserWindow({
    ...(restored ?? { width: 1440, height: 900 }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // Nothing is shown until the first frame is ready, which avoids the white
    // flash of an empty BrowserWindow. Requirement 1.4.
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
    titleBarStyle: 'default',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      // Keeps the renderer from reaching outside its own origin.
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  installNavigationGuards(
    window,
    isUrlTarget(rendererTarget)
      ? rendererTarget
      : `file://${rendererTarget}`,
  );

  window.once('ready-to-show', () => {
    window.show();
  });

  // Persist geometry, debounced: resize fires continuously during a drag and
  // each write is a database transaction.
  let saveTimer: NodeJS.Timeout | undefined;
  const persistGeometry = (): void => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (window.isDestroyed()) return;
      const [x, y] = window.getPosition();
      const [width, height] = window.getSize();
      try {
        settingsService.set(ctx().handle.db, 'windowGeometry', {
          x: x ?? 0,
          y: y ?? 0,
          width: width ?? 1440,
          height: height ?? 900,
        });
      } catch {
        // Losing a geometry write is cosmetic; never let it break the window.
      }
    }, 400);
  };

  window.on('resize', persistGeometry);
  window.on('move', persistGeometry);
  window.on('closed', () => {
    clearTimeout(saveTimer);
    mainWindow = null;
  });

  const load = isUrlTarget(rendererTarget)
    ? window.loadURL(rendererTarget)
    : window.loadFile(rendererTarget);

  void load.catch((cause: unknown) => {
    // A failed load leaves an invisible window and no error, which is the
    // hardest kind of startup bug to diagnose. Make it loud.
    console.error('[window] failed to load renderer:', rendererTarget, cause);
    window.show();
  });

  mainWindow = window;
  return window;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow !== null && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** Focus the existing window, used by the single-instance handler. */
export function focusMainWindow(): void {
  const window = getMainWindow();
  if (window === null) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  getMainWindow()?.webContents.send(channel, ...args);
}

export function watchSystemTheme(): void {
  nativeTheme.on('updated', () => {
    sendToRenderer(EVENTS.themeChanged, nativeTheme.shouldUseDarkColors);
  });
}

export { MIN_WIDTH, MIN_HEIGHT };
