import type { JSX } from "react";
import { InlineNotice } from "../../../shared";
import type { INativeBrowserView } from "../../../shared/nativeBrowser";

interface INativeBrowserConnectionStatusProps {
  view: INativeBrowserView;
  id?: string;
  compact?: boolean;
}

export function NativeBrowserConnectionStatus({
  view,
  id,
  compact = false,
}: INativeBrowserConnectionStatusProps): JSX.Element {
  if (compact) {
    return (
      <span data-testid="NativeBrowserConnectionStatus" className="ml-1 text-md" role="status">
        Browser {view.connectionStatus}
        {view.errorMessage !== null
          ? " · error"
          : view.observation?.isNativeSessionLost === true
            ? " · native session lost"
            : null}
      </span>
    );
  }
  return (
    <section
      data-testid="NativeBrowserConnectionStatus"
      aria-label="Native browser control status"
      className="pointer-events-auto flex min-w-0 flex-col gap-1 rounded-md border border-edge bg-card p-2 text-card-foreground shadow-frame wrap-anywhere"
      id={id}
    >
      <p role="status">
        {view.connectionStatus === "connecting"
          ? "Connecting to the configured browser…"
          : view.connectionStatus === "disconnected"
            ? "Browser control is disconnected."
            : "Browser control is connected."}
      </p>
      <p>
        {view.observation?.message ??
          "Connect to the browser configured for this project. Native DevTools stays open when you disconnect."}
      </p>
      {view.observation?.isNativeWindowOpen === true ? (
        <p>A native DevTools window is present. Its selected panel and live inspection state are shown there.</p>
      ) : null}
      {view.errorMessage !== null ? <InlineNotice tone="danger">{view.errorMessage}</InlineNotice> : null}
    </section>
  );
}
