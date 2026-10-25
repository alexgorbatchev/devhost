import { Button } from "@alexgorbatchev/shadcn";
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
        <Button
          size="icon-sm"
          variant={sharing.shouldIncludeSnapshot ? "secondary" : "ghost"}
          aria-label="Include Tab Snapshot"
          title="Include Tab Snapshot"
          aria-pressed={sharing.shouldIncludeSnapshot}
          onClick={() => sharing.setShouldIncludeSnapshot(!sharing.shouldIncludeSnapshot)}
        >
          <Icon glyph={CameraIcon} />
        </Button>
      ) : null}
      <Button
        size="sm"
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
