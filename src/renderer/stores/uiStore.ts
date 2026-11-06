import { create } from 'zustand';
import { DEFAULT_SETTINGS, PANEL_LIMITS } from '@shared/domain/defaults';
import type {
  AppSettings,
  PanelLayout,
  ThemePreference,
} from '@shared/domain/types';
import type { StagedImport } from '@shared/ipc/api';
import type { ExportScopeRequest } from '@shared/ipc/schemas';
import { api, callOr } from '../lib/client';

/**
 * Panel layout, theme and transient UI state.
 *
 * Layout changes are written through to settings but debounced, because a
 * divider drag fires continuously and each write is a database transaction.
 */

export type DialogKind =
  | { kind: 'none' }
  | { kind: 'settings' }
  | { kind: 'about' }
  | { kind: 'restore' }
  | {
      kind: 'confirmDelete';
      target: { type: 'trip' | 'folder'; id: string; name: string };
      counts: Record<string, number>;
    }
  /** Files already parsed and staged in the main process, awaiting confirmation. */
  | { kind: 'import'; staged: StagedImport[] }
  | { kind: 'export'; scope: ExportScopeRequest };

interface UiState {
  layout: PanelLayout;
  theme: ThemePreference;
  systemPrefersDark: boolean;
  dialog: DialogKind;
  toast: { message: string; tone: 'info' | 'error' } | null;
  mapOffline: boolean;

  hydrate(settings: AppSettings, systemPrefersDark: boolean): void;
  setLayout(patch: Partial<PanelLayout>): void;
  toggleLibrary(): void;
  toggleProperties(): void;
  setTheme(theme: ThemePreference): void;
  setSystemPrefersDark(dark: boolean): void;
  openDialog(dialog: DialogKind): void;
  closeDialog(): void;
  showToast(message: string, tone?: 'info' | 'error'): void;
  dismissToast(): void;
  setMapOffline(offline: boolean): void;
  isDark(): boolean;
}

let layoutTimer: ReturnType<typeof setTimeout> | undefined;

function persistLayout(layout: PanelLayout): void {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    void callOr(api().settings.set({ key: 'panelLayout', value: layout }), null);
  }, 300);
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const useUiStore = create<UiState>((set, get) => ({
  layout: DEFAULT_SETTINGS.panelLayout,
  theme: DEFAULT_SETTINGS.theme,
  systemPrefersDark: false,
  dialog: { kind: 'none' },
  toast: null,
  mapOffline: false,

  hydrate: (settings, systemPrefersDark) => {
    set({
      layout: settings.panelLayout,
      theme: settings.theme,
      systemPrefersDark,
    });
  },

  setLayout: (patch) => {
    const next: PanelLayout = { ...get().layout, ...patch };
    next.libraryWidth = clamp(
      next.libraryWidth,
      PANEL_LIMITS.libraryMin,
      PANEL_LIMITS.libraryMax,
    );
    next.propertiesWidth = clamp(
      next.propertiesWidth,
      PANEL_LIMITS.propertiesMin,
      PANEL_LIMITS.propertiesMax,
    );
    set({ layout: next });
    persistLayout(next);
  },

  toggleLibrary: () =>
    get().setLayout({ libraryVisible: !get().layout.libraryVisible }),

  toggleProperties: () =>
    get().setLayout({ propertiesVisible: !get().layout.propertiesVisible }),

  setTheme: (theme) => {
    set({ theme });
    void callOr(api().settings.set({ key: 'theme', value: theme }), null);
  },

  setSystemPrefersDark: (dark) => set({ systemPrefersDark: dark }),

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: { kind: 'none' } }),

  showToast: (message, tone = 'info') => set({ toast: { message, tone } }),
  dismissToast: () => set({ toast: null }),

  setMapOffline: (mapOffline) => set({ mapOffline }),

  isDark: () => {
    const { theme, systemPrefersDark } = get();
    return theme === 'system' ? systemPrefersDark : theme === 'dark';
  },
}));
