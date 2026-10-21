import type { ITabSnapshot } from "./types";

const captureFrameTimeoutMs: number = 10_000;

export async function readSharedTabFrame(
  document: Document,
  stream: MediaStream,
  signal?: AbortSignal,
): Promise<ITabSnapshot> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const timeout = AbortSignal.timeout(captureFrameTimeoutMs);
  const cancellation = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  try {
    await waitForFrame(video, stream, cancellation);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context === null || canvas.width === 0 || canvas.height === 0) {
      throw new Error("The shared tab did not produce a usable image.");
    }
    context.drawImage(video, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } finally {
    video.pause();
    video.srcObject = null;
  }
}

function waitForFrame(video: HTMLVideoElement, stream: MediaStream, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let frameId: number = 0;
    const cleanup = (): void => {
      video.cancelVideoFrameCallback(frameId);
      signal.removeEventListener("abort", onAbort);
      for (const track of stream.getTracks()) {
        track.removeEventListener("ended", onEnded);
      }
    };
    const fail = (error: unknown): void => {
      cleanup();
      reject(error);
    };
    const onAbort = (): void => fail(signal.reason);
    const onEnded = (): void => fail(new Error("Tab sharing ended before the screenshot was captured."));
    if (signal.aborted) {
      fail(signal.reason);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", onEnded, { once: true });
    }
    frameId = video.requestVideoFrameCallback(() => {
      cleanup();
      resolve();
    });
    void video.play().catch(fail);
  });
}
