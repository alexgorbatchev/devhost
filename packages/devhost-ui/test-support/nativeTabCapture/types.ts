import type { Server } from "bun";
export interface ITabCaptureAcceptanceOptions {
  topLayer?: "modal" | "popover";
  isChatAnnotated?: boolean;
  isSharingAheadOfTime?: boolean;
}
export interface ITabCaptureFixtureServer {
  server: Server<undefined>;
  readCommands: () => readonly unknown[];
  sentCommand: Promise<unknown>;
}
export interface ITabCapturePixelProof {
  width: number;
  height: number;
  shape: number[];
  host: number[];
  panel: number[];
  dock: number[];
  expectedShape: number[];
  expectedHost: number[];
  expectedPage: number[];
  expectedPanel: number[];
  layer: number[];
  expectedLayer: number[];
  tools: number[];
}
export interface ITabCaptureTrackProof {
  state: MediaStreamTrackState;
  surface: string | undefined;
  kind: string;
}
export interface ITabCaptureAcceptanceProof {
  image: ITabCapturePixelProof;
  tracks: ITabCaptureTrackProof[];
  pngSha256: string;
}
