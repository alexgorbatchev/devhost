import { TooltipIconButton } from "@alexgorbatchev/shadcn/assistant-ui/tooltip-icon-button";
import { CameraIcon, MonitorOffIcon, MonitorUpIcon } from "lucide-react";
import { useContext, type JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { TabShareContext } from "../TabShareContext";

export function TabShareActions(): JSX.Element | null {
  const sharing = useContext(TabShareContext);
  if (!sharing) return null;
  const shareLabel = sharing.stream ? "Stop Sharing" : sharing.isRequesting ? "Sharing…" : "Share Tab";
  return (
    <div data-testid="TabShareActions" role="group" aria-label="Tab sharing" className="flex items-center gap-1.5">
      {sharing.stream ? (
        <TooltipIconButton
          tooltip="Include Tab Snapshot"
          side="top"
          variant={sharing.shouldIncludeSnapshot ? "secondary" : "ghost"}
          aria-pressed={sharing.shouldIncludeSnapshot}
          onClick={() => sharing.setShouldIncludeSnapshot(!sharing.shouldIncludeSnapshot)}
        >
          <Icon glyph={CameraIcon} />
        </TooltipIconButton>
      ) : null}
      <TooltipIconButton
        tooltip={shareLabel}
        side="top"
        variant={sharing.stream ? "secondary" : "ghost"}
        aria-pressed={Boolean(sharing.stream)}
        disabled={sharing.isRequesting}
        onClick={() => {
          if (sharing.stream) sharing.stop();
          else {
            sharing.setShouldIncludeSnapshot(true);
            void sharing.share();
          }
        }}
      >
        <Icon
          glyph={sharing.stream ? MonitorOffIcon : MonitorUpIcon}
          tone={sharing.stream ? "destructive" : "current"}
        />
      </TooltipIconButton>
    </div>
  );
}
