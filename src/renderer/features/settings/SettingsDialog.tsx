import type { ReactNode } from 'react';
import { MAP_PROVIDERS } from '@shared/map/MapProvider';
import type { ThemePreference, UnitSystem } from '@shared/domain/types';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUiStore } from '../../stores/uiStore';

/** Settings apply immediately and persist on change. No restart, no OK button. */
export function SettingsDialog(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.set);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const setTheme = useUiStore((s) => s.setTheme);

  const rowClass = 'flex items-center justify-between gap-4 py-2';
  const labelClass = 'text-[13px] text-[var(--color-text-primary)]';
  const hintClass = 'text-[11px] text-[var(--color-text-muted)]';
  const controlClass =
    'rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)]';

  return (
    <Dialog
      title="Settings"
      width={520}
      onClose={closeDialog}
      footer={
        <Button variant="primary" onClick={closeDialog}>
          Done
        </Button>
      }
    >
      <div className={rowClass}>
        <div>
          <p className={labelClass}>Appearance</p>
          <p className={hintClass}>Follow the system, or pick one.</p>
        </div>
        <select
          aria-label="Appearance"
          value={settings.theme}
          onChange={(event) => {
            const theme = event.target.value as ThemePreference;
            setTheme(theme);
            void update({ key: 'theme', value: theme });
          }}
          className={controlClass}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Units</p>
          <p className={hintClass}>
            Display only — distances are always stored in metres.
          </p>
        </div>
        <select
          aria-label="Units"
          value={settings.units}
          onChange={(event) =>
            void update({ key: 'units', value: event.target.value as UnitSystem })
          }
          className={controlClass}
        >
          <option value="metric">Metric (km, m)</option>
          <option value="imperial">Imperial (mi, ft)</option>
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Base map</p>
          <p className={hintClass}>More providers arrive in a later phase.</p>
        </div>
        <select
          aria-label="Base map"
          value={settings.mapProviderId}
          onChange={(event) =>
            void update({ key: 'mapProviderId', value: event.target.value })
          }
          className={controlClass}
        >
          {MAP_PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Automatic backup</p>
          <p className={hintClass}>How often a snapshot is taken.</p>
        </div>
        <select
          aria-label="Backup interval"
          value={settings.backupIntervalHours}
          onChange={(event) =>
            void update({
              key: 'backupIntervalHours',
              value: Number(event.target.value),
            })
          }
          className={controlClass}
        >
          <option value={6}>Every 6 hours</option>
          <option value={12}>Every 12 hours</option>
          <option value={24}>Daily</option>
          <option value={168}>Weekly</option>
        </select>
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Backups kept</p>
          <p className={hintClass}>Older snapshots are pruned automatically.</p>
        </div>
        <input
          type="number"
          aria-label="Backups kept"
          min={1}
          max={100}
          value={settings.backupRetention}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= 100) {
              void update({ key: 'backupRetention', value });
            }
          }}
          className={`${controlClass} w-20`}
        />
      </div>

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Planning speed</p>
          <p className={hintClass}>
            Used for route duration estimates, and labelled as an estimate.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            aria-label="Planning speed in km/h"
            min={0.5}
            max={100}
            step={0.5}
            value={settings.planningSpeedKmh}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 0.5 && value <= 100) {
                void update({ key: 'planningSpeedKmh', value });
              }
            }}
            className={`${controlClass} w-20`}
          />
          <span className={hintClass}>km/h</span>
        </div>
      </div>
    </Dialog>
  );
}
