import type { ReactNode } from "react";
import type { LatLon } from "@shared/geo/distance";
import { WAZE_LIMITATION, wazeTargetFor } from "@shared/integrations/waze";
import { Button } from "../../components/Button";
import * as actions from "../../lib/actions";

/**
 * Hands one point to Waze — Requirement 7.
 *
 * The label says "end point" for a route or track, because that is what is
 * actually sent. Waze's deep link accepts a single destination and has no
 * parameter for intermediate stops, so there is no "send the whole route"
 * action anywhere in the application. A button that appeared to send a route
 * and silently sent one point would be exactly the misleading affordance the
 * honesty rule in the architecture steering forbids.
 *
 * Disabled with a reason when there is no geometry, rather than hidden: a
 * control that comes and goes is harder to understand than one that explains
 * itself.
 */
export function WazeButton({
  selection,
}: {
  selection:
    | { kind: "waypoint"; name: string; point: LatLon }
    | { kind: "route" | "track"; name: string; points: readonly LatLon[] };
}): ReactNode {
  const target = wazeTargetFor(selection);

  if (target === null) {
    return (
      <Button disabled title="There is no point here to send.">
        Open in Waze
      </Button>
    );
  }

  const isSinglePoint = selection.kind === "waypoint";

  return (
    <Button
      onClick={() => void actions.openInWaze(target.point)}
      title={
        isSinglePoint
          ? `Navigate to ${target.label} in Waze`
          : `Navigate to the end point of ${selection.name} in Waze. ${WAZE_LIMITATION}`
      }
    >
      {isSinglePoint ? "Open in Waze" : "End point in Waze"}
    </Button>
  );
}
