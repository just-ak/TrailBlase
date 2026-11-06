import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { EVENTS, type MenuAction } from '@shared/ipc/channels';
import { openExternal } from '../security/navigation';
import { sendToRenderer } from '../window';

const REPOSITORY_URL = 'https://github.com/trailrt/trailrt';

/**
 * The native menu bar, matching section 16 of the source specification.
 *
 * Items whose feature arrives in a later phase are present but **disabled**,
 * so the menu is honest about what the application can and cannot do rather
 * than offering controls that silently do nothing. Requirement 10.2.
 *
 * There is no bare "Save": every edit is already committed to SQLite, so the
 * item would have nothing to do. It is "Save a Copy…", which exports. See
 * ADR 0001.
 */

const dispatch = (action: MenuAction) => (): void => {
  sendToRenderer(EVENTS.menuAction, action);
};

/** Marks an item that needs a later phase. The tooltip says which. */
function later(
  label: string,
  phase: string,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    label,
    enabled: false,
    toolTip: `Arrives in ${phase}`,
    ...(accelerator === undefined ? {} : { accelerator }),
  };
}

export function buildApplicationMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'About TrailRT', click: dispatch('about:open') },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'Cmd+,',
          click: dispatch('settings:open'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Trip',
          accelerator: 'Cmd+N',
          click: dispatch('trip:new'),
        },
        {
          label: 'New Folder',
          accelerator: 'Shift+Cmd+N',
          click: dispatch('folder:new'),
        },
        { type: 'separator' },
        later('Open…', 'Phase 3', 'Cmd+O'),
        later('Import…', 'Phase 3', 'Shift+Cmd+I'),
        later('Export…', 'Phase 3', 'Shift+Cmd+E'),
        { type: 'separator' },
        {
          // Not "Save": there is no unsaved state to flush. ADR 0001.
          label: 'Save a Copy…',
          accelerator: 'Shift+Cmd+S',
          click: dispatch('export:copy'),
        },
        { type: 'separator' },
        { label: 'Back Up Now', click: dispatch('backup:create') },
        { label: 'Restore from Backup…', click: dispatch('backup:restore') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // The history stack is Phase 2. Phase 1 routes every mutation through
        // a service that reports its inverse, which is what makes that
        // possible without touching call sites.
        later('Undo', 'Phase 2', 'Cmd+Z'),
        later('Redo', 'Phase 2', 'Shift+Cmd+Z'),
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        {
          label: 'Delete',
          accelerator: 'Delete',
          click: dispatch('selection:delete'),
        },
        {
          label: 'Select All',
          accelerator: 'Cmd+A',
          click: dispatch('selection:selectAll'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Show/Hide Library',
          accelerator: 'Alt+Cmd+1',
          click: dispatch('panel:toggleLibrary'),
        },
        {
          label: 'Show/Hide Properties',
          accelerator: 'Alt+Cmd+2',
          click: dispatch('panel:togglePanelProperties'),
        },
        { type: 'separator' },
        { label: 'Map Layers…', click: dispatch('map:layers') },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'Cmd+Plus',
          click: dispatch('map:zoomIn'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'Cmd+-',
          click: dispatch('map:zoomOut'),
        },
        {
          label: 'Fit Trip to Screen',
          accelerator: 'Cmd+0',
          // Enabled but inert until a trip has geometry to fit. The renderer
          // reports when nothing is fittable rather than the menu pretending.
          click: dispatch('map:fitTrip'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Trip',
      submenu: [
        later('New Route', 'Phase 2'),
        later('New Track', 'Phase 3'),
        later('New Waypoint', 'Phase 2'),
        { type: 'separator' },
        { label: 'Rename Trip…', click: dispatch('trip:rename') },
        { label: 'Duplicate Trip', click: dispatch('trip:duplicate') },
        { label: 'Delete Trip…', click: dispatch('trip:delete') },
      ],
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }],
    },
    {
      role: 'help',
      submenu: [
        { label: 'About TrailRT', click: dispatch('about:open') },
        { type: 'separator' },
        {
          label: 'Documentation',
          click: () => {
            void openExternal(`${REPOSITORY_URL}#readme`).catch(() => {});
          },
        },
        {
          label: 'Report a Problem',
          click: () => {
            void openExternal(`${REPOSITORY_URL}/issues/new`).catch(() => {});
          },
        },
        { type: 'separator' },
        {
          label: 'Licence (GPL-3.0)',
          click: () => {
            void openExternal('https://www.gnu.org/licenses/gpl-3.0.html').catch(
              () => {},
            );
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

export function installApplicationMenu(): void {
  Menu.setApplicationMenu(buildApplicationMenu());
}
