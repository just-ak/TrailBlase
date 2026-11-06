import { useEffect, useState, type ReactNode } from "react";
import { MAP_OVERLAYS, MAP_PROVIDERS } from "@shared/map/MapProvider";
import { checkRoutingOrigin } from "@shared/net/origin";
import {
  TRANSPORT_MODES,
  type TransportMode,
} from "@shared/routing/RoutingProvider";
import type { ConsentNotice } from "@shared/routing/results";
import type { ThemePreference, UnitSystem } from "@shared/domain/types";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { api, callOr } from "../../lib/client";
import { useRoutingStore } from "../../stores/routingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";

const TRANSPORT_LABELS: Record<TransportMode, string> = {
  auto: "Car",
  motorcycle: "Motorcycle",
  bicycle: "Bicycle",
  pedestrian: "Walking",
};

/** Settings apply immediately and persist on change. No restart, no OK button. */
export function SettingsDialog(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.set);
  const closeDialog = useUiStore((s) => s.closeDialog);
  const setTheme = useUiStore((s) => s.setTheme);

  const rowClass = "flex items-center justify-between gap-4 py-2";
  const labelClass = "text-[13px] text-[var(--color-text-primary)]";
  const hintClass = "text-[11px] text-[var(--color-text-muted)]";
  const controlClass =
    "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)]";

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
            void update({ key: "theme", value: theme });
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
            void update({
              key: "units",
              value: event.target.value as UnitSystem,
            })
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
          <p className={hintClass}>
            OpenTopoMap stops at zoom 17; the app will not request past it.
          </p>
        </div>
        <select
          aria-label="Base map"
          value={settings.mapProviderId}
          onChange={(event) =>
            void update({ key: "mapProviderId", value: event.target.value })
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

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Overlay</p>
          <p className={hintClass}>
            Chosen independently of the base map. Only a user-supplied overlay
            ships — no third-party overlay service has been vetted.
          </p>
        </div>
        <select
          aria-label="Overlay"
          value={settings.mapOverlayId}
          onChange={(event) =>
            void update({ key: "mapOverlayId", value: event.target.value })
          }
          className={controlClass}
        >
          <option value="">None</option>
          {MAP_OVERLAYS.map((overlay) => (
            <option key={overlay.id} value={overlay.id}>
              {overlay.name}
            </option>
          ))}
        </select>
      </div>

      <div className="py-2">
        <p className={labelClass}>Custom tile URL</p>
        <p className={`${hintClass} mb-1`}>
          A Leaflet template with <code>{"{z}/{x}/{y}"}</code> placeholders.
          Used when “Custom tile source” is the base map. A local tile server or
          a <code>file://</code> directory works here.
        </p>
        <input
          type="text"
          aria-label="Custom tile URL"
          spellCheck={false}
          placeholder="https://tiles.example.org/{z}/{x}/{y}.png"
          value={settings.customTileUrl}
          onChange={(event) =>
            void update({ key: "customTileUrl", value: event.target.value })
          }
          className={`${controlClass} w-full font-mono text-[12px]`}
        />
      </div>

      <div className="py-2">
        <p className={labelClass}>Custom overlay URL</p>
        <input
          type="text"
          aria-label="Custom overlay URL"
          spellCheck={false}
          placeholder="https://overlay.example.org/{z}/{x}/{y}.png"
          value={settings.customOverlayUrl}
          onChange={(event) =>
            void update({ key: "customOverlayUrl", value: event.target.value })
          }
          className={`${controlClass} w-full font-mono text-[12px]`}
        />
      </div>

      <div className="my-3 h-px bg-[var(--color-border-subtle)]" />

      <RoutingSettings />

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
              key: "backupIntervalHours",
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
              void update({ key: "backupRetention", value });
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
                void update({ key: "planningSpeedKmh", value });
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

/**
 * Routing service configuration and consent.
 *
 * Three things this section has to do honestly, all of them Requirement 12:
 *
 * 1. **Default to nothing.** No endpoint ships. The application is complete
 *    without one, and the copy says so rather than presenting an empty field as
 *    a missing step.
 * 2. **Validate as you type, with the real reason.** The endpoint goes through
 *    the same `checkRoutingOrigin` the main process uses for the CSP and for
 *    every request, so the message here is the message that would be enforced.
 * 3. **Ask before transmitting, naming the host.** Consent is per host and is
 *    withdrawn automatically when the endpoint changes, so the checkbox below
 *    always refers to the host shown above it.
 */
function RoutingSettings(): ReactNode {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.set);
  const loadStatus = useRoutingStore((s) => s.loadStatus);
  const status = useRoutingStore((s) => s.status);

  /*
   * A local draft of the endpoint, committed on blur.
   *
   * Writing on every keystroke would persist half-typed URLs, each one
   * rebuilding the CSP, and would withdraw consent the moment the first
   * character of an edit landed.
   *
   * `null` means "no edit in progress, show the stored value". That sentinel
   * replaces what would otherwise be an effect copying settings into state,
   * which starts a second render for a value already available in the first.
   */
  const [edit, setEdit] = useState<string | null>(null);
  const [notice, setNotice] = useState<ConsentNotice | null>(null);
  const draft = edit ?? settings.routingEndpoint;

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    const endpoint = settings.routingEndpoint;

    // The empty case resolves through the same async path rather than calling
    // setState synchronously, which would start another render inside the
    // effect for nothing.
    void (async () => {
      const result =
        endpoint.trim().length === 0
          ? null
          : await callOr(api().routing.consentNotice({ endpoint }), null);
      if (!cancelled) setNotice(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.routingEndpoint]);

  const check = checkRoutingOrigin(draft);
  const draftEmpty = draft.trim().length === 0;
  const draftInvalid = !draftEmpty && !check.ok;

  /**
   * Persists a routing setting and refreshes the derived status.
   *
   * Re-read here rather than in an effect keyed on the settings, because the
   * status is a consequence of this write and nothing else changes it.
   */
  const applyRouting = async (
    request: Parameters<typeof update>[0],
  ): Promise<void> => {
    await update(request);
    await loadStatus();
  };

  const commit = (): void => {
    if (edit === null) return;
    const value = draft.trim();
    setEdit(null);
    if (value === settings.routingEndpoint) return;
    // Refused locally rather than sent and rejected: the schema would reject it
    // too, and a round trip to be told the same thing is just slower.
    if (draftInvalid) return;
    void applyRouting({ key: "routingEndpoint", value });
  };

  const rowClass = "flex items-center justify-between gap-4 py-2";
  const labelClass = "text-[13px] text-[var(--color-text-primary)]";
  const hintClass = "text-[11px] text-[var(--color-text-muted)]";
  const controlClass =
    "rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-2 py-1 text-[13px] text-[var(--color-text-primary)]";

  return (
    <section aria-labelledby="routing-heading">
      <h3
        id="routing-heading"
        className="mb-1 text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase"
      >
        Road routing
      </h3>
      <p className={`${hintClass} mb-2`}>
        Optional. With no service configured, routes are straight lines between
        the points you place and TrailRT makes no network requests beyond map
        tiles. Everything else keeps working exactly as it does now.
      </p>

      <div className="py-2">
        <p className={labelClass}>Routing endpoint</p>
        <p className={`${hintClass} mb-1`}>
          The base URL of a Valhalla instance — your own, or one you are
          permitted to use. <strong>https</strong> anywhere; plain{" "}
          <strong>http</strong> only for a service on this machine.
        </p>
        <input
          type="text"
          aria-label="Routing endpoint"
          aria-invalid={draftInvalid}
          spellCheck={false}
          placeholder="http://localhost:8002"
          value={draft}
          onChange={(event) => setEdit(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            // Abandons the edit and falls back to the stored value.
            if (event.key === "Escape") setEdit(null);
          }}
          className={`${controlClass} w-full font-mono text-[12px] ${
            draftInvalid ? "border-[var(--color-danger)]" : ""
          }`}
        />
        {draftInvalid && (
          <p
            role="alert"
            className="mt-1 text-[11px] text-[var(--color-danger)]"
          >
            {check.message}
          </p>
        )}
        {!draftInvalid && !draftEmpty && check.origin !== null && (
          <p className={`${hintClass} mt-1`}>
            Requests would go to <code>{check.origin}</code>, and that is the
            only outbound host the app is allowed to contact.
          </p>
        )}
      </div>

      {notice !== null && (
        <div className="my-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-sunken)] p-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={settings.routingConsentAccepted}
              onChange={(event) =>
                void applyRouting({
                  key: "routingConsentAccepted",
                  value: event.target.checked,
                })
              }
              className="mt-0.5"
            />
            <span className="text-[13px] text-[var(--color-text-primary)]">
              Send coordinates to <code>{notice.origin}</code> when I snap a
              route or look up road data.
            </span>
          </label>

          <p className={`${hintClass} mt-2 font-semibold`}>What is sent</p>
          <ul className={`${hintClass} list-disc pl-4`}>
            {notice.transmits.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <p className={`${hintClass} mt-2 font-semibold`}>What is not sent</p>
          <ul className={`${hintClass} list-disc pl-4`}>
            {notice.withholds.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <p className={`${hintClass} mt-2`}>
            Changing the endpoint withdraws this automatically — agreeing to one
            host is not agreeing to the next.
          </p>
        </div>
      )}

      <div className={rowClass}>
        <div>
          <p className={labelClass}>Transport mode</p>
          <p className={hintClass}>
            Which roads a snapped route is allowed to use.
          </p>
        </div>
        <select
          aria-label="Transport mode"
          value={settings.transportMode}
          onChange={(event) =>
            void applyRouting({
              key: "transportMode",
              value: event.target.value as TransportMode,
            })
          }
          className={controlClass}
        >
          {TRANSPORT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {TRANSPORT_LABELS[mode]}
            </option>
          ))}
        </select>
      </div>

      {status !== null && (
        <p className={hintClass}>
          {status.available
            ? `Ready. ${status.attribution ?? ""}`
            : (status.message ?? "")}
          {status.available && !status.verifiedAgainstLiveInstance && (
            <>
              {" "}
              The Valhalla adapter is written against the published API
              reference and tested against synthetic fixtures, not against a
              live instance. If a response looks wrong, that is why.
            </>
          )}
        </p>
      )}
    </section>
  );
}
