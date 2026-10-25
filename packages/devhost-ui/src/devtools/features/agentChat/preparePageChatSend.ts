import type { ISelectedAnnotationTarget } from "../annotationComposer/annotationComposerModels";
import type { IAnnotationShape, ITabSnapshot } from "../visualAnnotations/types";
import type { IChatPreparedSend } from "./types";

interface IPreparePageChatSendOptions {
  text: string;
  title: string;
  url: string;
  targets: readonly ISelectedAnnotationTarget[];
  shapes: readonly IAnnotationShape[];
  capture?: () => Promise<ITabSnapshot>;
  selectSnapshot?: (snapshot: ITabSnapshot) => Promise<ITabSnapshot>;
}

export async function preparePageChatSend(options: IPreparePageChatSendOptions): Promise<IChatPreparedSend> {
  if (options.targets.length === 0 && options.shapes.length === 0 && !options.capture) return { text: options.text };
  // Capture the shared tab before resolving element metadata.
  const captured = await options.capture?.();
  const markers = await Promise.all(
    options.targets.map((target) => target.candidate.buildMarkerPayload(target.markerNumber)),
  );
  const snapshot = captured && options.selectSnapshot ? await options.selectSnapshot(captured) : captured;
  const context = {
    title: options.title,
    url: options.url,
    markers,
    shapes: options.shapes,
    ...(snapshot
      ? {
          screenshot: {
            width: snapshot.width,
            height: snapshot.height,
            ...(snapshot.crop ? { crop: snapshot.crop } : {}),
          },
        }
      : {}),
  };
  return {
    text: `${options.text}\n\nPage context:\n${JSON.stringify(context)}`,
    ...(snapshot ? { images: [{ dataURL: snapshot.dataUrl }] } : {}),
  };
}
