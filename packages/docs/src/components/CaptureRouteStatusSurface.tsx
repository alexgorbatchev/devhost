import { useEffect, type JSX } from "react";

const captureRouteStatusReadyEventName = "devhost-capture-route-status-ready";

interface ISourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

interface ICaptureRouteStatusSurfaceProps {
  source: ISourceLocation;
}

interface ICaptureRouteStatusContentProps {
  __source: ISourceLocation;
}

export function CaptureRouteStatusSurface({ source }: ICaptureRouteStatusSurfaceProps): JSX.Element {
  const captureRouteStatusContentProps: ICaptureRouteStatusContentProps = { __source: source };

  useEffect((): void => {
    window.dispatchEvent(new CustomEvent(captureRouteStatusReadyEventName));
  }, []);

  return <CaptureRouteStatusContent {...captureRouteStatusContentProps} />;
}

function CaptureRouteStatusContent({ __source }: ICaptureRouteStatusContentProps): JSX.Element {
  return (
    <article
      className="captureCard captureRouteStatus"
      data-capture-route-source-file={__source.fileName}
      data-testid="MarketingCapturePage--route-status-card"
    >
      <p className="captureLabel">Routing + health</p>
      <h2>Managed route status</h2>
      <p data-capture-route-status-text>
        Waiting for the managed route to become live so the recorder can reveal the final healthy state.
      </p>
      <button
        className="captureRouteButton"
        data-devhost-cursor="pointer"
        data-testid="MarketingCapturePage--route-live-button"
        type="button"
      >
        Reveal live route
      </button>
    </article>
  );
}
