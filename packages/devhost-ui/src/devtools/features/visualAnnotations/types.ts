export interface ITabSnapshot {
  dataUrl: string;
  width: number;
  height: number;
}

export type CaptureFrameCheck = () => boolean;

export interface ITabCaptureOptions {
  document: Document;
  mediaDevices: Pick<MediaDevices, "getDisplayMedia">;
  signal?: AbortSignal;
  sharedStream?: MediaStream;
  /** Return the viewport rectangles whose visible pixels must change before accepting a prepared frame. */
  prepare?: () => Promise<readonly DOMRectReadOnly[] | void>;
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
