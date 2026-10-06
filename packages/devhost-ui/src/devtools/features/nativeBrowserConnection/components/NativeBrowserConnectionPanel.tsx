import type { JSX } from "react";
import { Button, InlineNotice } from "../../../shared";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import type { INativeBrowserView } from "../../../shared/nativeBrowser";

interface INativeBrowserConnectionPanelProps {
  view: INativeBrowserView;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
}

export function NativeBrowserConnectionPanel({
  view,
  onConnect,
  onDisconnect,
}: INativeBrowserConnectionPanelProps): JSX.Element {
  const isDisconnected: boolean = view.connectionStatus === "disconnected";
  const isConnecting: boolean = view.connectionStatus === "connecting";
  return (
    <ToolbarPopover
      testId="NativeBrowserConnectionPanel"
      triggerLabel="Native browser connection"
      triggerContent={<span>Browser</span>}
      panelLabel="Native browser connection"
      panelWidth="md"
      notice={view.errorMessage !== null ? <InlineNotice tone="danger">{view.errorMessage}</InlineNotice> : undefined}
    >
      <div className="space-y-2 p-2">
        <p role="status">
          {isConnecting
            ? "Connecting to the configured browser…"
            : isDisconnected
              ? "Browser control is disconnected."
              : "Browser control is connected."}
        </p>
        {view.observation !== null ? (
          <p>{view.observation.message}</p>
        ) : (
          <p>Connect to the browser configured for this project. Native DevTools stays open when you disconnect.</p>
        )}
        {view.observation?.isNativeWindowOpen === true ? (
          <p>A native DevTools window is present. Its selected panel and live inspection state are shown there.</p>
        ) : null}
        <div className="flex gap-1">
          {isDisconnected ? (
            <Button
              onClick={(): void => {
                void onConnect();
              }}
            >
              Connect browser control
            </Button>
          ) : (
            <Button onClick={onDisconnect}>Disconnect browser control</Button>
          )}
        </div>
      </div>
    </ToolbarPopover>
  );
}
