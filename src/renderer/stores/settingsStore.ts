import { create } from 'zustand';
import { DEFAULT_SETTINGS } from '@shared/domain/defaults';
import type { AppSettings } from '@shared/domain/types';
import type { SettingsSetRequest } from '@shared/ipc/schemas';
import { api, call, callOr } from '../lib/client';

/**
 * Mirror of persisted settings. The main process owns them; this is a cache
 * that is replaced wholesale by whatever a write returns.
 */
interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load(): Promise<AppSettings>;
  set(request: SettingsSetRequest): Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    const settings = await call(api().settings.all());
    set({ settings, loaded: true });
    return settings;
  },

  set: async (request) => {
    const updated = await callOr(api().settings.set(request), null);
    if (updated !== null) set({ settings: updated });
  },
}));
