import type { ITabDisplayMediaOptions } from "./types";

export async function requestTabShare(mediaDevices: Pick<MediaDevices, "getDisplayMedia">): Promise<MediaStream> {
  if (typeof mediaDevices?.getDisplayMedia !== "function") {
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
  const stream = await mediaDevices.getDisplayMedia(constraints);
  if (stream.getVideoTracks()[0]?.getSettings().displaySurface !== "browser") {
    for (const track of stream.getTracks()) track.stop();
    throw new Error("Select this browser tab to include the page and its annotations.");
  }
  return stream;
}
