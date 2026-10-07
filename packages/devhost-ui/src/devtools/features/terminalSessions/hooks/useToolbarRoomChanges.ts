import { useEffect, useState, type RefObject } from "react";

/**
 * Renders its component again whenever the room a toolbar segment can take may have changed without the component
 * rendering: the segment is squeezed or released by its neighbours, the toolbar resizes, or the viewport does. A
 * toolbar that is already as wide as it can be does not resize when a neighbour grows, and a toolbar that hugs its
 * content does not resize when the viewport grows, so all three are watched.
 *
 * The segment may exist only some of the time; `isSegmentRendered` says when. Returns how many changes it has seen,
 * which a component that only needs to render again can ignore.
 */
export function useToolbarRoomChanges(
  segmentReference: RefObject<HTMLElement | null>,
  isSegmentRendered: boolean,
): number {
  const [changeCount, setChangeCount] = useState<number>(0);

  useEffect(() => {
    const segment: HTMLElement | null = segmentReference.current;

    if (!isSegmentRendered || segment === null) {
      return;
    }

    const countChange = (): void => {
      setChangeCount((currentChangeCount: number): number => currentChangeCount + 1);
    };
    const resizeObserver = new ResizeObserver(countChange);

    resizeObserver.observe(segment);
    if (segment.parentElement !== null) {
      resizeObserver.observe(segment.parentElement);
    }
    window.addEventListener("resize", countChange);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", countChange);
    };
  }, [isSegmentRendered, segmentReference]);

  return changeCount;
}
