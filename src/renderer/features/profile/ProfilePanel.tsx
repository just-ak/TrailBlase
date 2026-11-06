import { useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import type { AttributeOwnerType } from "@shared/routing/results";
import { Button } from "../../components/Button";
import { api, call, describeError } from "../../lib/client";
import { getMapInstance, useMapInstance } from "../map/mapInstance";
import { useRoutingStore, routingKey } from "../../stores/routingStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useUiStore } from "../../stores/uiStore";
import { ProfileChart } from "./ProfileChart";

/**
 * The profile panel: a drawer under the map for the selected route or track.
 *
 * Opened by the user, not by selection. Building a profile reads the full point
 * array of a geometry that may be 200,000 samples, and doing that every time
 * something is clicked would make selection feel slow for a panel most users
 * have closed.
 *
 * Hover works in both directions (Requirement 5.5): moving along the chart
 * drops a marker on the map, and the same state drives the chart's crosshair.
 */

/** Marker shown on the map at the hovered distance. */
function useHoverMarker(
  map: L.Map | null,
  point: { lat: number; lon: number } | null,
): void {
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    if (map === null) return;
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (map === null) return;

    if (point === null) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    // Moved rather than recreated: a pointer move fires continuously, and
    // adding and removing a layer each time is what makes a hover feel laggy.
    if (markerRef.current === null) {
      markerRef.current = L.circleMarker([point.lat, point.lon], {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#f59e0b",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
      return;
    }
    markerRef.current.setLatLng([point.lat, point.lon]);
  }, [map, point]);
}

export function ProfilePanel({
  ownerType,
  ownerId,
  onClose,
}: {
  ownerType: AttributeOwnerType;
  ownerId: string;
  onClose: () => void;
}): ReactNode {
  const units = useSettingsStore((s) => s.settings.units);
  const showToast = useUiStore((s) => s.showToast);
  const map = useMapInstance();

  const profile = useRoutingStore(
    (s) => s.profiles[routingKey(ownerType, ownerId)],
  );
  const loadProfile = useRoutingStore((s) => s.loadProfile);

  const [hoverDistanceM, setHoverDistanceM] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const chartRef = useRef<HTMLDivElement | null>(null);

  /*
   * No synchronous reset of hover or failure state here.
   *
   * The panel is mounted with a `key` of the geometry it describes, so a change
   * of selection remounts it with fresh state. That is React's documented way
   * to reset state on a prop change, and it avoids a setState inside an effect
   * starting a second render on every open.
   */
  useEffect(() => {
    void loadProfile(ownerType, ownerId).then((result) => {
      if (result === null) {
        setFailed("This geometry does not have enough points to profile.");
      }
    });
  }, [loadProfile, ownerType, ownerId]);

  const hovered =
    profile === undefined || hoverDistanceM === null
      ? null
      : nearestSample(profile.samples, hoverDistanceM);

  useHoverMarker(map, hovered);

  /**
   * Exports the chart as a PNG.
   *
   * The SVG is rasterised here because only the renderer has the DOM to do it;
   * the bytes then go to the main process, which owns the save dialog and the
   * filesystem. The renderer never learns where the file went — it gets a
   * basename back for the confirmation and nothing more.
   */
  const exportImage = async (): Promise<void> => {
    const svg = chartRef.current?.querySelector("svg");
    if (svg === null || svg === undefined) return;

    try {
      const serialised = new XMLSerializer().serializeToString(svg);
      const png = await rasterise(serialised, svg);
      const saved = await call(
        api().app.savePng({ suggestedName: "route-profile", base64: png }),
      );
      if (saved.cancelled) return;
      showToast(`Profile saved as ${saved.fileName ?? "an image"}.`);
    } catch (cause) {
      showToast(describeError(cause), "error");
    }
  };

  return (
    <section
      aria-label="Route profile"
      className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
          Profile
        </h2>
        <div className="flex items-center gap-2">
          <Button onClick={() => void exportImage()}>Export image…</Button>
          <button
            type="button"
            aria-label="Close profile"
            onClick={() => {
              setHoverDistanceM(null);
              onClose();
            }}
            className="rounded px-2 py-1 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]"
          >
            ✕
          </button>
        </div>
      </div>

      {failed !== null && (
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          {failed}
        </p>
      )}

      {failed === null && profile === undefined && (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Building profile…
        </p>
      )}

      {profile !== undefined && (
        <div ref={chartRef}>
          <ProfileChart
            profile={profile}
            units={units}
            hoverDistanceM={hoverDistanceM}
            onHover={(distanceM) => {
              setHoverDistanceM(distanceM);
              // Keep the map centred only when the user drags past the edge;
              // panning on every hover would fight the pointer.
              if (distanceM === null) return;
              const sample = nearestSample(profile.samples, distanceM);
              if (sample === null) return;
              const instance = getMapInstance();
              if (instance === null) return;
              if (!instance.getBounds().contains([sample.lat, sample.lon])) {
                instance.panTo([sample.lat, sample.lon], { animate: false });
              }
            }}
          />
        </div>
      )}
    </section>
  );
}

/** Nearest sample by distance. Linear scan is fine at the thinned sample count. */
function nearestSample(
  samples: readonly { distanceM: number; lat: number; lon: number }[],
  targetM: number,
): { lat: number; lon: number; distanceM: number } | null {
  let best: { lat: number; lon: number; distanceM: number } | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const delta = Math.abs(sample.distanceM - targetM);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = sample;
    }
  }
  return best;
}

/**
 * Rasterises a serialised SVG to base64 PNG.
 *
 * A data URL rather than a blob URL: `URL.createObjectURL` would need revoking
 * and the CSP allows `data:` for images already, so this needs no policy
 * change. The CSS variables the chart uses are resolved before serialisation by
 * the caller's computed styles being inlined — see `inlineColours`.
 */
async function rasterise(
  serialised: string,
  source: SVGElement,
): Promise<string> {
  const inlined = inlineColours(serialised, source);
  const width = source.clientWidth || 760;
  const height = source.clientHeight || 200;

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve());
    image.addEventListener("error", () =>
      reject(new Error("The profile could not be rendered to an image.")),
    );
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(inlined)}`;
  await loaded;

  // 2× for a legible image on a non-retina display or in a document.
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("The profile could not be rendered to an image.");
  }
  // An opaque background: a transparent PNG of a thin line on a dark theme is
  // invisible wherever it gets pasted.
  context.fillStyle =
    getComputedStyle(source).getPropertyValue("--color-surface").trim() ||
    "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/**
 * Replaces `var(--token)` references with their resolved values.
 *
 * An SVG rasterised through an `Image` has no access to the document's
 * stylesheet, so every CSS variable would resolve to nothing and the chart
 * would come out blank. Resolving them against the live element is the only way
 * to get the theme the user is actually looking at.
 */
function inlineColours(serialised: string, source: SVGElement): string {
  const styles = getComputedStyle(source);
  return serialised.replace(
    /var\((--[a-z0-9-]+)\)/gi,
    (_match, token: string) => {
      const value = styles.getPropertyValue(token).trim();
      return value.length > 0 ? value : "#888888";
    },
  );
}
