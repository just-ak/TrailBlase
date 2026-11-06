import { useState, type ReactNode } from 'react';
import type { UnitSystem, Waypoint } from '@shared/domain/types';
import { isKnownSymbol, WAYPOINT_SYMBOLS } from '@shared/domain/symbols';
import { formatElevation, formatTimestamp } from '@shared/geo/units';
import { isValidLat, isValidLon } from '@shared/geo/distance';
import { Button } from '../../components/Button';
import * as actions from '../../lib/actions';
import { useUiStore } from '../../stores/uiStore';
import { Field, INPUT_CLASS, ReadOnly } from './fields';

/**
 * Waypoint inspector.
 *
 * Coordinates are editable with validation, so a typo is rejected with an
 * explanation rather than silently clamped or written as nonsense
 * (Requirement 3.2).
 */
export function WaypointProperties({
  waypoint,
  units,
}: {
  waypoint: Waypoint;
  units: UnitSystem;
}): ReactNode {
  const showToast = useUiStore((s) => s.showToast);

  const [name, setName] = useState(waypoint.name);
  const [lat, setLat] = useState(String(waypoint.lat));
  const [lon, setLon] = useState(String(waypoint.lon));
  const [elevation, setElevation] = useState(
    waypoint.eleM === null ? '' : String(waypoint.eleM),
  );
  const [description, setDescription] = useState(waypoint.description ?? '');
  const [notes, setNotes] = useState(waypoint.notes ?? '');

  const commitCoordinates = (): void => {
    const nextLat = Number(lat);
    const nextLon = Number(lon);

    if (!isValidLat(nextLat)) {
      showToast('Latitude must be a number between -90 and 90.', 'error');
      setLat(String(waypoint.lat));
      return;
    }
    if (!isValidLon(nextLon)) {
      showToast('Longitude must be a number between -180 and 180.', 'error');
      setLon(String(waypoint.lon));
      return;
    }
    if (nextLat === waypoint.lat && nextLon === waypoint.lon) return;
    void actions.moveWaypoint(waypoint.id, nextLat, nextLon);
  };

  const commitElevation = (): void => {
    const trimmed = elevation.trim();
    // Empty means unknown, which is null — not zero.
    if (trimmed.length === 0) {
      if (waypoint.eleM !== null) {
        void actions.updateWaypoint(waypoint.id, { eleM: null });
      }
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < -500 || value > 12_000) {
      showToast('Elevation must be a number of metres between -500 and 12000.', 'error');
      setElevation(waypoint.eleM === null ? '' : String(waypoint.eleM));
      return;
    }
    if (value !== waypoint.eleM) {
      void actions.updateWaypoint(waypoint.id, { eleM: value });
    }
  };

  const currentSymbol = waypoint.symbol ?? 'pin';
  const symbolIsImported = !isKnownSymbol(currentSymbol);

  return (
    <div className="h-full overflow-y-auto p-3">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Waypoint
      </h2>

      <Field label="Name">
        <input
          value={name}
          aria-label="Waypoint name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0) {
              setName(waypoint.name);
              showToast('A name cannot be empty.', 'error');
              return;
            }
            if (trimmed !== waypoint.name) {
              void actions.updateWaypoint(waypoint.id, { name: trimmed });
            }
          }}
          className={INPUT_CLASS}
        />
      </Field>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            Latitude
          </p>
          <input
            value={lat}
            aria-label="Latitude"
            inputMode="decimal"
            onChange={(event) => setLat(event.target.value)}
            onBlur={commitCoordinates}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
            Longitude
          </p>
          <input
            value={lon}
            aria-label="Longitude"
            inputMode="decimal"
            onChange={(event) => setLon(event.target.value)}
            onBlur={commitCoordinates}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <Field label="Elevation (metres)">
        <input
          value={elevation}
          aria-label="Elevation in metres"
          inputMode="decimal"
          placeholder="unknown"
          onChange={(event) => setElevation(event.target.value)}
          onBlur={commitElevation}
          className={INPUT_CLASS}
        />
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          Currently {formatElevation(waypoint.eleM, units)}. Leave empty if
          unknown — it will not be recorded as zero.
        </p>
      </Field>

      <Field label="Symbol">
        <select
          value={symbolIsImported ? '' : currentSymbol}
          aria-label="Symbol"
          onChange={(event) =>
            void actions.updateWaypoint(waypoint.id, {
              symbol: event.target.value,
            })
          }
          className={INPUT_CLASS}
        >
          {symbolIsImported && (
            <option value="">{currentSymbol} (imported)</option>
          )}
          {WAYPOINT_SYMBOLS.map((symbol) => (
            <option key={symbol.id} value={symbol.id}>
              {symbol.glyph} {symbol.label}
            </option>
          ))}
        </select>
        {symbolIsImported && (
          <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
            This symbol came from an imported file and is kept as-is so it can
            be exported unchanged.
          </p>
        )}
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          rows={3}
          aria-label="Description"
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => {
            const next = description.trim();
            if (next !== (waypoint.description ?? '')) {
              void actions.updateWaypoint(waypoint.id, {
                description: next.length === 0 ? null : next,
              });
            }
          }}
          className={`${INPUT_CLASS} resize-y`}
        />
      </Field>

      <Field label="Notes">
        <textarea
          value={notes}
          rows={3}
          aria-label="Notes"
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            const next = notes.trim();
            if (next !== (waypoint.notes ?? '')) {
              void actions.updateWaypoint(waypoint.id, {
                notes: next.length === 0 ? null : next,
              });
            }
          }}
          className={`${INPUT_CLASS} resize-y`}
        />
      </Field>

      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <Field label="Source">
        <ReadOnly
          value={waypoint.source === 'import' ? 'Imported' : 'Created here'}
        />
      </Field>

      <Field label="Last modified">
        <ReadOnly value={formatTimestamp(waypoint.updatedAt)} />
      </Field>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void actions.duplicateWaypoint(waypoint.id)}>
          Duplicate
        </Button>
        <Button
          variant="danger"
          onClick={() => void actions.deleteWaypoint(waypoint.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
