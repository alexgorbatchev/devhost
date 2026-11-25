import { Button } from "@alexgorbatchev/shadcn";
import { TooltipIconButton } from "@alexgorbatchev/shadcn/assistant-ui/tooltip-icon-button";
import { CameraIcon, MonitorUpIcon, SquareIcon } from "lucide-react";
import { useContext, type JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { TabShareContext } from "../TabShareContext";

export function TabShareActions(): JSX.Element | null {
  const sharing = useContext(TabShareContext);
  if (!sharing) return null;
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
      <Button
        size="default"
        variant="outline"
        disabled={sharing.isRequesting}
        onClick={() => {
          if (sharing.stream) sharing.stop();
          else {
            sharing.setShouldIncludeSnapshot(true);
            void sharing.share();
          }
        }}
      >
        <Icon glyph={sharing.stream ? SquareIcon : MonitorUpIcon} />
        {sharing.stream ? "Stop Sharing" : sharing.isRequesting ? "Sharing…" : "Share Tab"}
      </Button>
    </div>
  );
}
