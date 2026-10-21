import type { ITabCaptureOptions, ITabSnapshot } from "./types";
import { readSharedTabFrame } from "./readSharedTabFrame";
import { requestTabShare } from "./requestTabShare";

/** Call directly from the user's click: opening the picker requires transient user activation. */
export async function captureTabSnapshot(options: ITabCaptureOptions): Promise<ITabSnapshot> {
  options.signal?.throwIfAborted();
  const stream = options.sharedStream ?? (await requestTabShare(options.mediaDevices));
  try {
    options.signal?.throwIfAborted();
    const track = stream.getVideoTracks()[0];
    if (track?.getSettings().displaySurface !== "browser") {
      throw new Error("Select this browser tab to include the page and its annotations.");
    }
    return await readSharedTabFrame(options.document, stream, options.signal, options.prepare);
  } finally {
    if (!options.sharedStream) for (const track of stream.getTracks()) track.stop();
  }
}
