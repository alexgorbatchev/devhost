export interface IRectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ISelectedElementDraft {
  element: HTMLElement;
  elementName: string;
  elementPath: string;
  markerNumber: number;
  selectedText?: string;
}

export interface IAnnotationMarkerPayload {
  accessibility: string;
  boundingBox: IRectSnapshot;
  computedStyles: string;
  computedStylesObj: Record<string, string>;
  cssClasses: string;
  element: string;
  elementPath: string;
  fullPath: string;
  isFixed: boolean;
  markerNumber: number;
  nearbyElements: string;
  nearbyText: string;
  selectedText?: string;
}

export interface IAnnotationSubmitDetail {
  comment: string;
  markers: IAnnotationMarkerPayload[];
  stackName: string;
  submittedAt: number;
  title: string;
  url: string;
}
