import type { ITabCaptureOptions, ITabSnapshot } from "./types";

const captureFrameTimeoutMs: number = 10_000;

export async function readSharedTabFrame(
  document: Document,
  stream: MediaStream,
  signal?: AbortSignal,
  prepare?: ITabCaptureOptions["prepare"],
): Promise<ITabSnapshot> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  const timeout = AbortSignal.timeout(captureFrameTimeoutMs);
  const lifecycle = new AbortController();
  const cancellation = AbortSignal.any([lifecycle.signal, timeout, ...(signal ? [signal] : [])]);
  try {
    await waitForFrame(video, stream, cancellation);
    if (prepare) {
      // Start playback before changing the page, then consume the frame produced by that change.
      await prepare();
      cancellation.throwIfAborted();
      await waitForFrame(video, stream, cancellation, performance.now());
    }
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
    lifecycle.abort();
    video.pause();
    video.srcObject = null;
  }
}

function waitForFrame(
  video: HTMLVideoElement,
  stream: MediaStream,
  signal: AbortSignal,
  minimumFrameTime: number = 0,
): Promise<void> {
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
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      // Screen capture can deliver queued frames after the page changes. Use capture timing when provided.
      if (
        metadata.presentationTime < minimumFrameTime ||
        (metadata.captureTime !== undefined && metadata.captureTime < minimumFrameTime)
      ) {
        frameId = video.requestVideoFrameCallback(onFrame);
        return;
      }
      cleanup();
      resolve();
    };
    frameId = video.requestVideoFrameCallback(onFrame);
    void video.play().catch(fail);
  });
}
