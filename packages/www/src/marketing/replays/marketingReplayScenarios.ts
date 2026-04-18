export interface IMarketingRecordingViewport {
  height: number;
  width: number;
}

export type MarketingRecordingScenarioId = "annotation" | "overlay" | "routing-health" | "sessions" | "source-jumps";

export interface IMarketingRecordingScenario {
  id: MarketingRecordingScenarioId;
  label: string;
  recordingFileName: string;
  routeRevealDelayMs?: number;
  viewport: IMarketingRecordingViewport;
}

const desktopCaptureViewport: IMarketingRecordingViewport = {
  height: 960,
  width: 1440,
};

export const marketingRecordingScenarios: ReadonlyArray<IMarketingRecordingScenario> = [
  {
    id: "annotation",
    label: "Annotation handoff",
    recordingFileName: "annotation.json",
    viewport: desktopCaptureViewport,
  },
  {
    id: "source-jumps",
    label: "Source navigation",
    recordingFileName: "source-jumps.json",
    viewport: desktopCaptureViewport,
  },
  {
    id: "sessions",
    label: "Terminal sessions",
    recordingFileName: "sessions.json",
    viewport: desktopCaptureViewport,
  },
  {
    id: "overlay",
    label: "Devtools overlay",
    recordingFileName: "overlay.json",
    viewport: desktopCaptureViewport,
  },
  {
    id: "routing-health",
    label: "Routing + health",
    recordingFileName: "routing-health.json",
    routeRevealDelayMs: 2_400,
    viewport: desktopCaptureViewport,
  },
];

export function readMarketingRecordingScenario(scenarioId: string | null): IMarketingRecordingScenario | null {
  if (scenarioId === null) {
    return null;
  }

  return (
    marketingRecordingScenarios.find((scenario: IMarketingRecordingScenario): boolean => {
      return scenario.id === scenarioId;
    }) ?? null
  );
}

export function readMarketingRecordingUrl(recordingFileName: string): string {
  return `/recordings/marketing/${recordingFileName}`;
}
