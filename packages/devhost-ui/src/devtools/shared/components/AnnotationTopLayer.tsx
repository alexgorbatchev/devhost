import { useCallback, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { AnnotationTopLayerContext } from "../AnnotationTopLayerContext";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../constants";
import { observeAnnotationTopLayer } from "../observeAnnotationTopLayer";
import { promoteAnnotationTopLayer } from "../promoteAnnotationTopLayer";
import { resolveDevtoolsPortalContainer } from "../resolveDevtoolsPortalContainer";
import type { AnnotationLayerPlacement } from "../types";

interface IAnnotationTopLayerProps {
  children: ReactNode;
  isVisible: boolean;
  ref: RefObject<HTMLDivElement | null>;
  /**
   * `above-devtools` (the default) paints over every devtools surface. `below-devtools` paints over the host page,
   * including its popovers and modal dialogs, and under the devtools root and `coverReference`.
   */
  placement?: AnnotationLayerPlacement;
  /** The annotation layer that stays above a `below-devtools` layer. */
  coverReference?: RefObject<HTMLDivElement | null>;
}

/** A separate manual popover keeps annotations above the native UI they describe. */
export function AnnotationTopLayer({
  children,
  isVisible,
  ref,
  placement = "above-devtools",
  coverReference,
}: IAnnotationTopLayerProps): JSX.Element {
  const anchorReference = useRef<HTMLSpanElement | null>(null);
  const homeReference = useRef<HTMLElement | null>(null);
  const [mount, setMount] = useState<HTMLDivElement | null>(null);
  const hostReference = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorReference.current;
    if (anchor === null) return;
    const home = resolveDevtoolsPortalContainer(anchor);
    homeReference.current = home;
    const container = home.ownerDocument.createElement("div");
    container.className = "contents";
    const host = home.ownerDocument.createElement("div");
    host.setAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME, "");
    host.setAttribute("data-devhost-annotation-host", "");
    host.attachShadow({ mode: "open" });
    hostReference.current = host;
    home.append(container);
    setMount(container);
    return () => {
      container.remove();
      host.remove();
      hostReference.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const home = homeReference.current;
    const host = hostReference.current;
    const layer = ref.current;
    if (!isVisible || home === null || host === null || layer === null || mount === null) return;
    return observeAnnotationTopLayer({
      home,
      host,
      layer,
      mount,
      placement,
      readCover: () => coverReference?.current ?? null,
    });
  }, [coverReference, isVisible, mount, placement, ref]);

  const promote = useCallback((): void => {
    const home = homeReference.current;
    const layer = ref.current;
    if (home === null || layer === null) return;
    promoteAnnotationTopLayer({ home, layer, placement, cover: coverReference?.current ?? null });
  }, [coverReference, placement, ref]);

  return (
    <span hidden ref={anchorReference} data-testid="AnnotationTopLayer">
      {mount === null
        ? null
        : createPortal(
            <AnnotationTopLayerContext value={promote}>
              <div
                ref={ref}
                popover="manual"
                data-devhost-devtools=""
                data-devhost-annotation-layer={placement}
                data-testid="AnnotationTopLayer--surface"
                className="pointer-events-none fixed inset-0 m-0 size-auto overflow-visible border-0 bg-transparent p-0 text-foreground"
                onKeyDown={(event) => event.stopPropagation()}
                onKeyUp={(event) => event.stopPropagation()}
                onKeyPress={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
              >
                {children}
              </div>
            </AnnotationTopLayerContext>,
            mount,
          )}
    </span>
  );
}
