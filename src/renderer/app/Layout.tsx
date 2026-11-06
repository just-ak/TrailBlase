import type { ReactNode } from 'react';
import { PANEL_LIMITS } from '@shared/domain/defaults';
import { SplitPane } from '../components/SplitPane';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { MapView } from '../features/map/MapView';
import { PropertiesPanel } from '../features/properties/PropertiesPanel';
import { useUiStore } from '../stores/uiStore';

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

      <MapView />

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
