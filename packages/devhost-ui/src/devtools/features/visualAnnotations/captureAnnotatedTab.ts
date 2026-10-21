import { captureTabSnapshot } from "./captureTabSnapshot";
import type { ITabCaptureOptions, ITabSnapshot } from "./types";

interface IAnnotatedTabCaptureOptions extends Omit<ITabCaptureOptions, "prepare"> {
  root: HTMLElement;
}

export async function captureAnnotatedTab(options: IAnnotatedTabCaptureOptions): Promise<ITabSnapshot> {
  try {
    return await captureTabSnapshot({
      ...options,
      prepare: async () => {
        options.root.setAttribute("data-devhost-capturing", "");
        const timeout = AbortSignal.timeout(10_000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        await waitForPaint(signal);
        await waitForPaint(signal);
      },
    });
  } finally {
    options.root.removeAttribute("data-devhost-capturing");
  }
}

function waitForPaint(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const frame = requestAnimationFrame(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    });
    const abort = (): void => {
      cancelAnimationFrame(frame);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
