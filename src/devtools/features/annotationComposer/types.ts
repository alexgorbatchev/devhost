export interface IRectSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IAnnotationSourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

export interface ISelectedElementDraft {
  element: HTMLElement;
  elementName: string;
  elementPath: string;
  markerNumber: number;
  selectedText?: string;
  sourceLocation?: IAnnotationSourceLocation;
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
  sourceLocation?: IAnnotationSourceLocation;
}

export interface IAnnotationSubmitDetail {
  comment: string;
  markers: IAnnotationMarkerPayload[];
  stackName: string;
  submittedAt: number;
  title: string;
  url: string;
}
