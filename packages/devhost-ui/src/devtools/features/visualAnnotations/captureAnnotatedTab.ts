import { captureTabSnapshot } from "./captureTabSnapshot";
import type { IAnnotationShape, ITabCaptureOptions, ITabSnapshot } from "./types";
import type { ISelectedAnnotationTarget } from "../annotationComposer/annotationComposerModels";
import type { IRectSnapshot } from "../annotationComposer/types";

interface IAnnotatedTabCaptureOptions extends Omit<ITabCaptureOptions, "prepare"> {
  root: HTMLElement;
  annotationRoot?: HTMLElement | null;
  /** Devhost surfaces the annotations touch stay in the snapshot, because devhost UI is what they annotate. */
  shouldKeepAnnotatedSurfaces: boolean;
  selectedTargets?: readonly ISelectedAnnotationTarget[];
  shapes?: readonly IAnnotationShape[];
}

const annotationStrokePadding: number = 3;

export async function captureAnnotatedTab(options: IAnnotatedTabCaptureOptions): Promise<ITabSnapshot> {
  const includedSurfaces: Element[] = [];
  const roots = new Set([options.root, ...(options.annotationRoot ? [options.annotationRoot] : [])]);
  try {
    const bounds = options.shouldKeepAnnotatedSurfaces ? readAnnotationBounds(options) : [];
    const surfaces = new Set(
      Array.from(roots).flatMap((root) =>
        Array.from(root.querySelectorAll("[data-devhost-capture-exclude], :popover-open, :modal, [role=dialog]")),
      ),
    );
    for (const surface of surfaces) {
      if (
        surface === options.annotationRoot ||
        surface.closest("[data-devhost-annotation-controls]") !== null ||
        surface.hasAttribute("data-devhost-capture-include")
      )
        continue;
      const rectangle = surface.getBoundingClientRect();
      if (bounds.some((annotation) => intersects(annotation, rectangle))) includedSurfaces.push(surface);
    }
    return await captureTabSnapshot({
      ...options,
      prepare: async () => {
        const hiddenRegions = Array.from(surfaces)
          .filter(
            (surface) =>
              surface.hasAttribute("data-devhost-capture-exclude") &&
              !includedSurfaces.includes(surface) &&
              !surface.hasAttribute("data-devhost-capture-include") &&
              surface.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true }),
          )
          .map((surface) => surface.getBoundingClientRect());
        for (const surface of includedSurfaces) surface.setAttribute("data-devhost-capture-include", "");
        for (const root of roots) root.setAttribute("data-devhost-capturing", "");
        const timeout = AbortSignal.timeout(10_000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        await waitForPaint(signal);
        await waitForPaint(signal);
        return hiddenRegions;
      },
    });
  } finally {
    for (const root of roots) root.removeAttribute("data-devhost-capturing");
    for (const surface of includedSurfaces) surface.removeAttribute("data-devhost-capture-include");
  }
}

function readAnnotationBounds(options: IAnnotatedTabCaptureOptions): IRectSnapshot[] {
  const elements = (options.selectedTargets ?? []).flatMap((target) => {
    const rectangle = target.candidate.readRect();
    return rectangle === null ? [] : [rectangle];
  });
  const shapes = (options.shapes ?? []).map(
    (shape): IRectSnapshot => ({
      x: Math.min(shape.start.x, shape.end.x) - window.scrollX - annotationStrokePadding,
      y: Math.min(shape.start.y, shape.end.y) - window.scrollY - annotationStrokePadding,
      width: Math.abs(shape.end.x - shape.start.x) + annotationStrokePadding * 2,
      height: Math.abs(shape.end.y - shape.start.y) + annotationStrokePadding * 2,
    }),
  );
  return [...elements, ...shapes];
}

function intersects(annotation: IRectSnapshot, surface: DOMRect): boolean {
  return (
    surface.width > 0 &&
    surface.height > 0 &&
    annotation.x < surface.right &&
    annotation.x + annotation.width > surface.left &&
    annotation.y < surface.bottom &&
    annotation.y + annotation.height > surface.top
  );
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
