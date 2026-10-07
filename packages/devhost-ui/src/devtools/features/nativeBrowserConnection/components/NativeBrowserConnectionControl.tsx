import type { JSX } from "react";
import { Button } from "../../../shared";
import type { INativeBrowserView } from "../../../shared/nativeBrowser";

interface INativeBrowserConnectionControlProps {
  view: INativeBrowserView;
  statusId: string;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
}

/** The command changes with the connection; its native button and focus remain mounted. */
export function NativeBrowserConnectionControl({
  view,
  statusId,
  onConnect,
  onDisconnect,
}: INativeBrowserConnectionControlProps): JSX.Element {
  const isDisconnected: boolean = view.connectionStatus === "disconnected";
  return (
    <div
      aria-label="Native browser control"
      className="pointer-events-auto flex min-w-0 items-center rounded-md border border-edge bg-card p-1 text-card-foreground shadow-frame"
      role="group"
    >
      <Button
        aria-describedby={statusId}
        onClick={(): void => {
          if (isDisconnected) {
            void onConnect();
          } else {
            onDisconnect();
          }
        }}
      >
        {isDisconnected ? "Connect browser control" : "Disconnect browser control"}
      </Button>
    </div>
  );
}
