import { useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../constants";
import { observeAnnotationTopLayer } from "../observeAnnotationTopLayer";
import { resolveDevtoolsPortalContainer } from "../resolveDevtoolsPortalContainer";

interface IAnnotationTopLayerProps {
  children: ReactNode;
  isVisible: boolean;
  ref: RefObject<HTMLDivElement | null>;
}

/** A separate manual popover keeps annotations above the native UI they describe. */
export function AnnotationTopLayer({ children, isVisible, ref }: IAnnotationTopLayerProps): JSX.Element {
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
    return observeAnnotationTopLayer({ home, host, layer, mount });
  }, [isVisible, mount, ref]);

  return (
    <span hidden ref={anchorReference} data-testid="AnnotationTopLayer">
      {mount === null
        ? null
        : createPortal(
            <div
              ref={ref}
              popover="manual"
              data-devhost-devtools=""
              data-devhost-annotation-layer=""
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
            </div>,
            mount,
          )}
    </span>
  );
}
