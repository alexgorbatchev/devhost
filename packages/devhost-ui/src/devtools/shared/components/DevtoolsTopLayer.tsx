import { useLayoutEffect, useRef, type JSX, type ReactNode, type RefObject } from "react";

import { DEVTOOLS_ROOT_ID, TOP_LAYER_ELEMENT_SELECTOR } from "../constants";
import { promoteDevtoolsTopLayer } from "../promoteDevtoolsTopLayer";

interface IDevtoolsTopLayerProps {
  children: ReactNode;
  ref?: RefObject<HTMLDivElement | null>;
}

/**
 * The root of every devtools surface. A manual popover renders it in the browser's top layer, above every host
 * stacking context, without dismissing host popovers or intercepting pointer events. The top layer ignores z-index
 * between its elements, so all devtools surfaces share this one element and the `--devhost-z-*` tokens order them
 * inside its stacking context.
 *
 * Host popovers and modal dialogs opened later enter the top layer above the root, so it re-enters after each one.
 */
export function DevtoolsTopLayer({ children, ref }: IDevtoolsTopLayerProps): JSX.Element {
  const ownReference = useRef<HTMLDivElement | null>(null);
  const topLayerReference: RefObject<HTMLDivElement | null> = ref ?? ownReference;

  useLayoutEffect(() => {
    const topLayerElement: HTMLDivElement | null = topLayerReference.current;

    if (topLayerElement === null) {
      return;
    }

    const ownerDocument: Document = topLayerElement.ownerDocument;
    // `toggle` does not bubble and does not cross shadow boundaries: the capture listener sees host elements in
    // the document tree only. Host top-layer elements inside host shadow roots stay unobserved.
    const handleHostToggle = (event: Event): void => {
      const target: EventTarget | null = event.target;

      if (
        target instanceof Element &&
        !topLayerElement.contains(target) &&
        target.matches(TOP_LAYER_ELEMENT_SELECTOR)
      ) {
        promoteDevtoolsTopLayer(topLayerElement);
      }
    };
    // Promotion waits while a devtools popover or dialog is open, so retry once one of them closes.
    const handleOwnTopLayerChange = (event: Event): void => {
      if (event.target !== topLayerElement) {
        promoteDevtoolsTopLayer(topLayerElement);
      }
    };

    topLayerElement.showPopover();
    ownerDocument.addEventListener("toggle", handleHostToggle, true);
    topLayerElement.addEventListener("toggle", handleOwnTopLayerChange, true);

    return () => {
      ownerDocument.removeEventListener("toggle", handleHostToggle, true);
      topLayerElement.removeEventListener("toggle", handleOwnTopLayerChange, true);

      if (topLayerElement.matches(":popover-open")) {
        topLayerElement.hidePopover();
      }
    };
  }, [topLayerReference]);

  return (
    <div
      id={DEVTOOLS_ROOT_ID}
      ref={topLayerReference}
      // Resets every property of the user-agent `[popover]` rule; the surfaces inside position themselves.
      className="pointer-events-none fixed inset-0 m-0 size-auto overflow-visible border-0 bg-transparent p-0 text-foreground"
      data-devhost-devtools=""
      data-testid="DevtoolsTopLayer"
      popover="manual"
    >
      {children}
    </div>
  );
}
