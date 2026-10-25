import type { CaptureFrameCheck, ITabCaptureOptions, ITabSnapshot } from "./types";
import { createChangedRegionCheck } from "./createChangedRegionCheck";

const captureFrameTimeoutMs: number = 10_000;

export async function readSharedTabFrame(
  document: Document,
  stream: MediaStream,
  signal?: AbortSignal,
  prepare?: ITabCaptureOptions["prepare"],
  restore?: ITabCaptureOptions["restore"],
): Promise<ITabSnapshot> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const timeout = AbortSignal.timeout(captureFrameTimeoutMs);
  const lifecycle = new AbortController();
  const cancellation = AbortSignal.any([lifecycle.signal, timeout, ...(signal ? [signal] : [])]);
  let readerTrack: MediaStreamTrack | null = null;
  try {
    const sourceTrack = stream.getVideoTracks()[0];
    if (sourceTrack === undefined) throw new Error("Tab sharing ended before the screenshot was captured.");
    readerTrack = sourceTrack.clone();
    const readerStream = new MediaStream([readerTrack]);
    const constraints = readerTrack.getConstraints();
    const frameRate: ConstrainDoubleRange =
      typeof constraints.frameRate === "object" ? constraints.frameRate : { ideal: constraints.frameRate };
    // A static display may stop delivering frames. Constrain only this reader's clone so there is always a fresh
    // frame after snapshot preparation, without changing or stopping an explicitly opened share.
    await readerTrack.applyConstraints({
      ...constraints,
      frameRate: { ...frameRate, min: Math.max(1, frameRate.min ?? 0) },
    });
    cancellation.throwIfAborted();
    video.srcObject = readerStream;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("The shared tab did not produce a usable image.");
    }
    while (true) {
      await waitForFrame(video, readerStream, cancellation, performance.now());
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (canvas.width === 0 || canvas.height === 0) throw new Error("The shared tab did not produce a usable image.");
      const viewportWidth = document.defaultView?.innerWidth ?? canvas.width;
      const viewportHeight = document.defaultView?.innerHeight ?? canvas.height;
      context.drawImage(video, 0, 0);
      if (prepare) {
        // Start playback before changing the page, then consume the frame produced by that change.
        const before = context.getImageData(0, 0, canvas.width, canvas.height);
        const regions = await prepare(cancellation);
        cancellation.throwIfAborted();
        const hasChanged = createChangedRegionCheck(context, before, regions ?? [], viewportWidth, viewportHeight);
        // Reattach the video sink after preparation to request a fresh source frame, even for a static tab.
        // Keep the shared tracks running; only this snapshot reader is restarted.
        const minimumFrameTime = performance.now();
        video.pause();
        video.srcObject = null;
        video.srcObject = readerStream;
        let hasResized = false;
        await waitForFrame(video, readerStream, cancellation, minimumFrameTime, () => {
          hasResized =
            video.videoWidth !== canvas.width ||
            video.videoHeight !== canvas.height ||
            (document.defaultView !== null &&
              (document.defaultView.innerWidth !== viewportWidth ||
                document.defaultView.innerHeight !== viewportHeight));
          if (hasResized) return true;
          context.drawImage(video, 0, 0);
          return hasChanged();
        });
        if (hasResized) {
          // A sharing infobar can change both viewport and capture dimensions. Rebuild a visible baseline and
          // prepare again; resizing the old image would make its hidden-region comparison unreliable.
          await restore?.(cancellation);
          cancellation.throwIfAborted();
          continue;
        }
      }
      return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
    }
  } finally {
    lifecycle.abort();
    video.pause();
    video.srcObject = null;
    readerTrack?.stop();
  }
}

function waitForFrame(
  video: HTMLVideoElement,
  stream: MediaStream,
  signal: AbortSignal,
  minimumFrameTime: number = 0,
  accept?: CaptureFrameCheck,
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
      try {
        if (accept && !accept()) {
          frameId = video.requestVideoFrameCallback(onFrame);
          return;
        }
      } catch (error) {
        fail(error);
        return;
      }
      cleanup();
      resolve();
    };
    frameId = video.requestVideoFrameCallback(onFrame);
    void video.play().catch(fail);
  });
}
