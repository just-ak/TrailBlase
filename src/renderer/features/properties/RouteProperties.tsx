import { useState, type ReactNode } from 'react';
import type { RouteWithPoints, UnitSystem } from '@shared/domain/types';
import { ROUTE_COLOURS, routeColour } from '@shared/domain/symbols';
import {
  estimateDurationSeconds,
  formatCoordinates,
  formatDistance,
  formatDuration,
  formatElevation,
  formatTimestamp,
} from '@shared/geo/units';
import * as actions from '../../lib/actions';
import { Button } from '../../components/Button';
import { Field, INPUT_CLASS, ReadOnly } from './fields';

/**
 * Route inspector.
 *
 * Absent data is rendered as an em dash by the formatters, never as zero. A
 * route with no elevation data and a genuinely flat route are different facts
 * and this panel has to show the difference.
 */
export function RouteProperties({
  route,
  units,
  planningSpeedKmh,
}: {
  route: RouteWithPoints;
  units: UnitSystem;
  planningSpeedKmh: number;
}): ReactNode {
  const [name, setName] = useState(route.name);

  const first = route.points.at(0) ?? null;
  const last = route.points.at(-1) ?? null;
  const duration = estimateDurationSeconds(route.distanceM, planningSpeedKmh);
  const hasElevation = route.elevGainM !== null;

  return (
    <div className="h-full overflow-y-auto p-3">
      <h2 className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
        Route
      </h2>

      <Field label="Name">
        <input
          value={name}
          aria-label="Route name"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (trimmed.length === 0) {
              setName(route.name);
              return;
            }
            if (trimmed !== route.name) void actions.renameRoute(route.id, trimmed);
          }}
          className={INPUT_CLASS}
        />
      </Field>

      <Field label="Colour">
        <div className="flex flex-wrap gap-1.5">
          {ROUTE_COLOURS.map((option) => (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={routeColour(route.colour) === option.hex}
              onClick={() => void actions.setRouteColour(route.id, option.hex)}
              style={{ background: option.hex }}
              className={`h-6 w-6 rounded-full border-2 ${
                routeColour(route.colour) === option.hex
                  ? 'border-[var(--color-text-primary)]'
                  : 'border-transparent'
              }`}
            />
          ))}
        </div>
      </Field>

      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <Field label="Distance">
        <ReadOnly value={formatDistance(route.distanceM, units)} />
      </Field>

      <Field label="Points">
        <ReadOnly value={String(route.pointCount)} />
      </Field>

      <Field label="Start">
        <ReadOnly
          value={first === null ? '—' : formatCoordinates(first.lat, first.lon)}
        />
      </Field>

      <Field label="End">
        <ReadOnly
          value={last === null ? '—' : formatCoordinates(last.lat, last.lon)}
        />
      </Field>

      <Field label="Estimated duration">
        <ReadOnly value={formatDuration(duration)} />
        {/* Labelled as an estimate with the speed visible: this is not a
            measurement, and Requirement 4.3 forbids implying it is. */}
        <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)]">
          Estimate at {planningSpeedKmh} km/h — change in Settings
        </p>
      </Field>

      <Field label="Elevation">
        {hasElevation ? (
          <ul className="text-[13px] text-[var(--color-text-primary)]">
            <li>Gain {formatElevation(route.elevGainM, units)}</li>
            <li>Loss {formatElevation(route.elevLossM, units)}</li>
            <li>
              Range {formatElevation(route.elevMinM, units)} –{' '}
              {formatElevation(route.elevMaxM, units)}
            </li>
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No elevation data in this route.
          </p>
        )}
      </Field>

      <div className="my-4 h-px bg-[var(--color-border-subtle)]" />

      <Field label="Source">
        <ReadOnly value={route.source === 'import' ? 'Imported' : 'Drawn here'} />
      </Field>

      <Field label="Last modified">
        <ReadOnly value={formatTimestamp(route.updatedAt)} />
      </Field>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void actions.reverseRoute(route.id)}>Reverse</Button>
        <Button onClick={() => void actions.duplicateRoute(route.id)}>
          Duplicate
        </Button>
        <Button variant="danger" onClick={() => void actions.deleteRoute(route.id)}>
          Delete
        </Button>
      </div>
    </div>
  );
}
