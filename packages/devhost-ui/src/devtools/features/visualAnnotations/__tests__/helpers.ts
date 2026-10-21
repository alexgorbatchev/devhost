import { vi } from "vitest";

export function createSharedTabFixture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "red";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0]!;
  vi.spyOn(track, "getSettings").mockReturnValue({ displaySurface: "browser" });
  return { document, mediaDevices: { getDisplayMedia: async () => stream }, stream, track };
}
