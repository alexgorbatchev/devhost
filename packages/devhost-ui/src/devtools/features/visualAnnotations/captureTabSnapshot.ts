import type { ITabCaptureOptions, ITabDisplayMediaOptions, ITabSnapshot } from "./types";
import { readSharedTabFrame } from "./readSharedTabFrame";

/** Call directly from the user's click: opening the picker requires transient user activation. */
export async function captureTabSnapshot(options: ITabCaptureOptions): Promise<ITabSnapshot> {
  options.signal?.throwIfAborted();
  if (typeof options.mediaDevices?.getDisplayMedia !== "function") {
    throw new Error("Tab sharing is unavailable. Open this page in a browser that supports screen capture over HTTPS.");
  }
  const constraints: ITabDisplayMediaOptions = {
    audio: false,
    video: { displaySurface: "browser" },
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    monitorTypeSurfaces: "exclude",
  };
  const stream = await options.mediaDevices.getDisplayMedia(constraints);
  try {
    options.signal?.throwIfAborted();
    const track = stream.getVideoTracks()[0];
    if (track?.getSettings().displaySurface !== "browser") {
      throw new Error("Select this browser tab to include the page and its annotations.");
    }
    await options.prepare();
    options.signal?.throwIfAborted();
    return await readSharedTabFrame(options.document, stream, options.signal);
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}
