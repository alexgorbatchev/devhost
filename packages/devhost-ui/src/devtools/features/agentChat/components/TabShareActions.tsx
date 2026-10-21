import { Button } from "@alexgorbatchev/shadcn";
import { MonitorUpIcon, SquareIcon } from "lucide-react";
import { useContext, type JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { TabShareContext } from "../TabShareContext";

export function TabShareActions(): JSX.Element | null {
  const sharing = useContext(TabShareContext);
  if (!sharing) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={sharing.isRequesting}
      onClick={() => {
        if (sharing.stream) sharing.stop();
        else void sharing.share();
      }}
    >
      <Icon glyph={sharing.stream ? SquareIcon : MonitorUpIcon} />
      {sharing.stream ? "Stop Sharing" : sharing.isRequesting ? "Sharing…" : "Share Tab"}
    </Button>
  );
}
