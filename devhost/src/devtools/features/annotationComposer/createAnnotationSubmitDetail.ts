import type { IAnnotationMarkerPayload, IAnnotationSubmitDetail } from "./types";

interface ICreateAnnotationSubmitDetailOptions {
  comment: string;
  markers: IAnnotationMarkerPayload[];
  stackName: string;
  submittedAt: number;
  title: string;
  url: string;
}

export function createAnnotationSubmitDetail(
  options: ICreateAnnotationSubmitDetailOptions,
): IAnnotationSubmitDetail {
  return {
    comment: options.comment,
    markers: options.markers,
    stackName: options.stackName,
    submittedAt: options.submittedAt,
    title: options.title,
    url: options.url,
  };
}
