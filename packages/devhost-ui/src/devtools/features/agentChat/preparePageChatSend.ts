import type { ISelectedAnnotationTarget } from "../annotationComposer/annotationComposerModels";
import type { IAnnotationShape, ITabSnapshot } from "../visualAnnotations/types";
import type { IChatPreparedSend } from "./types";

interface IPreparePageChatSendOptions {
  text: string;
  title: string;
  url: string;
  targets: readonly ISelectedAnnotationTarget[];
  shapes: readonly IAnnotationShape[];
  capture: () => Promise<ITabSnapshot>;
}

export async function preparePageChatSend(options: IPreparePageChatSendOptions): Promise<IChatPreparedSend> {
  if (options.targets.length === 0 && options.shapes.length === 0) return { text: options.text };
  // Invoke the browser picker before any await consumes the send gesture's transient activation.
  const snapshot = await options.capture();
  const markers = await Promise.all(
    options.targets.map((target) => target.candidate.buildMarkerPayload(target.markerNumber)),
  );
  const context = {
    title: options.title,
    url: options.url,
    markers,
    shapes: options.shapes,
    screenshot: { width: snapshot.width, height: snapshot.height },
  };
  return {
    text: `${options.text}\n\nPage context (the attached tab snapshot includes the annotations):\n${JSON.stringify(context)}`,
    images: [{ dataURL: snapshot.dataUrl }],
  };
}
