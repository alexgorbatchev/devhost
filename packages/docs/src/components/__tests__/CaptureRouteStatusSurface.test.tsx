import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CaptureRouteStatusSurface } from "../CaptureRouteStatusSurface";

describe("CaptureRouteStatusSurface", () => {
  it("renders the route-status card and reveal button for source navigation", () => {
    const markup: string = renderToStaticMarkup(
      <CaptureRouteStatusSurface
        source={{
          columnNumber: 1,
          componentName: "CaptureRouteStatusSurface",
          fileName: "src/components/CaptureRouteStatusSurface.tsx",
          lineNumber: 1,
        }}
      />,
    );

    expect(markup).toMatchInlineSnapshot(
      `"<article class=\"captureCard captureRouteStatus\" data-capture-route-source-file=\"src/components/CaptureRouteStatusSurface.tsx\" data-testid=\"MarketingCapturePage--route-status-card\"><p class=\"captureLabel\">Routing + health</p><h2>Managed route status</h2><p data-capture-route-status-text=\"true\">Waiting for the managed route to become live so the recorder can reveal the final healthy state.</p><button class=\"captureRouteButton\" data-devhost-cursor=\"pointer\" data-testid=\"MarketingCapturePage--route-live-button\" type=\"button\">Reveal live route</button></article>"`,
    );
  });
});
