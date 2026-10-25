export interface ITabSnapshot {
  dataUrl: string;
  width: number;
  height: number;
  crop?: IScreenshotCrop;
}

/** Coordinates are pixels in the original captured image, not CSS viewport pixels. */
export interface IScreenshotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IScreenshotCrop extends IScreenshotArea {
  sourceWidth: number;
  sourceHeight: number;
}

export type CaptureFrameCheck = () => boolean;

export interface ITabCaptureOptions {
  document: Document;
  mediaDevices: Pick<MediaDevices, "getDisplayMedia">;
  signal?: AbortSignal;
  sharedStream?: MediaStream;
  /** Return the viewport rectangles whose visible pixels must change before accepting a prepared frame. */
  prepare?: (signal: AbortSignal) => Promise<readonly DOMRectReadOnly[] | void>;
  /** Restore visible surfaces before rebuilding the baseline after a capture resize. */
  restore?: (signal: AbortSignal) => Promise<void>;
}

export interface ITabDisplayMediaOptions extends DisplayMediaStreamOptions {
  preferCurrentTab: boolean;
  selfBrowserSurface: "include";
  surfaceSwitching: "exclude";
  monitorTypeSurfaces: "exclude";
}

export type AnnotationShapeKind = "arrow" | "line" | "box";

export interface IAnnotationPoint {
  x: number;
  y: number;
}

export interface IAnnotationShape {
  id: string;
  kind: AnnotationShapeKind;
  start: IAnnotationPoint;
  end: IAnnotationPoint;
}
