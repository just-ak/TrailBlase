import type { ReactNode } from "react";
import { PANEL_LIMITS } from "@shared/domain/defaults";
import { SplitPane } from "../components/SplitPane";
import { LibraryPanel } from "../features/library/LibraryPanel";
import { MapView } from "../features/map/MapView";
import { ProfilePanel } from "../features/profile/ProfilePanel";
import { PropertiesPanel } from "../features/properties/PropertiesPanel";
import { useUiStore } from "../stores/uiStore";

/**
 * The three-panel workspace: library, map, properties.
 *
 * The map is the flex child so it absorbs all remaining width. Hiding a side
 * panel therefore reflows the map rather than leaving a gap, and the
 * ResizeObserver in useLeafletMap keeps Leaflet's internal size in step.
 */
export function Layout(): ReactNode {
  const layout = useUiStore((s) => s.layout);
  const setLayout = useUiStore((s) => s.setLayout);
  const profile = useUiStore((s) => s.profile);
  const closeProfile = useUiStore((s) => s.closeProfile);

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--color-surface)]">
      {layout.libraryVisible && (
        <SplitPane
          side="left"
          label="library panel"
          width={layout.libraryWidth}
          min={PANEL_LIMITS.libraryMin}
          max={PANEL_LIMITS.libraryMax}
          onResize={(libraryWidth) => setLayout({ libraryWidth })}
        >
          <LibraryPanel />
        </SplitPane>
      )}

      {/*
        The map and the profile drawer share a column, so opening the drawer
        shortens the map rather than overlaying it. An overlay would cover the
        part of the route the user is hovering over, which is the one thing the
        profile is for.
      */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <MapView />
        {profile !== null && (
          <ProfilePanel
            // Remount on a change of geometry so no stale hover survives.
            key={`${profile.ownerType}:${profile.ownerId}`}
            ownerType={profile.ownerType}
            ownerId={profile.ownerId}
            onClose={closeProfile}
          />
        )}
      </div>

      {layout.propertiesVisible && (
        <SplitPane
          side="right"
          label="properties panel"
          width={layout.propertiesWidth}
          min={PANEL_LIMITS.propertiesMin}
          max={PANEL_LIMITS.propertiesMax}
          onResize={(propertiesWidth) => setLayout({ propertiesWidth })}
        >
          <PropertiesPanel />
        </SplitPane>
      )}
    </div>
  );
}
