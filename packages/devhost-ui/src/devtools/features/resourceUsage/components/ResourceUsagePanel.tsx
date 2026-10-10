import type { JSX } from "react";

import { cn } from "../../../../lib/utils";
import { ToolbarSegment } from "../../../shared/components/ToolbarSegment";
import { RESOURCE_DANGER_PERCENT, RESOURCE_WARNING_PERCENT } from "../constants";
import { createResourceReadouts } from "../createResourceReadouts";
import type { IResourceReadout, IResourceUsage } from "../types";

// A meter turns critical only above `high`, while the critical level starts at it. Percentages shown are whole, so
// half a percent below puts the boundary between the last warning value and the first critical one.
const HALF_PERCENT: number = 0.5;

interface IResourceUsagePanelProps {
  usage: IResourceUsage | null;
}

/**
 * Toolbar segment with the host's CPU, memory, and disk usage. Each readout is a native meter whose low/high
 * regions pick the normal, warning, and critical fill; the figures behind a percentage are in its tooltip.
 */
export function ResourceUsagePanel({ usage }: IResourceUsagePanelProps): JSX.Element | null {
  const readouts: IResourceReadout[] = usage === null ? [] : createResourceReadouts(usage);

  if (readouts.length === 0) {
    return null;
  }

  return (
    <ToolbarSegment ariaLabel="Host resource usage" testId="ResourceUsagePanel">
      {readouts.map((readout: IResourceReadout) => (
        <span
          key={readout.key}
          className="flex items-center gap-1 not-last:pr-1"
          data-testid="ResourceUsagePanel--readout"
          title={`${readout.label}: ${readout.detail}`}
        >
          <span className="text-muted-foreground">{readout.label}</span>
          <meter
            aria-label={`${readout.label} usage`}
            data-slot="usage-meter"
            high={RESOURCE_DANGER_PERCENT - HALF_PERCENT}
            low={RESOURCE_WARNING_PERCENT}
            max={100}
            min={0}
            optimum={0}
            value={readout.percent}
          >
            {readout.percent}%
          </meter>
          {/* Reserve every value's width independently of the critical number's heavier font metrics. */}
          <span className="w-[4ch] shrink-0 tabular-nums">
            <span className={cn(readout.level === "danger" && "font-semibold")}>{readout.percent}%</span>
          </span>
        </span>
      ))}
    </ToolbarSegment>
  );
}
