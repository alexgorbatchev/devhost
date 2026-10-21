import { useLayoutEffect, useRef, type JSX, type ReactNode, type RefObject } from "react";

import { DEVTOOLS_ROOT_ID, TOP_LAYER_ELEMENT_SELECTOR } from "../constants";
import type { INativeBrowserBinding } from "../nativeBrowser/types";
import { promoteDevtoolsTopLayer } from "../promoteDevtoolsTopLayer";

const KEYBOARD_EVENT_TYPES: readonly string[] = ["keydown", "keypress", "keyup"];

interface IDevtoolsTopLayerProps {
  children: ReactNode;
  nativeBrowserBinding?: INativeBrowserBinding | null;
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
export function DevtoolsTopLayer({ children, nativeBrowserBinding, ref }: IDevtoolsTopLayerProps): JSX.Element {
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
    // `toggle` closes a panel before its overlay transition removes it from the top layer. Retry once that
    // transition ends (or is canceled), when moving the trigger can no longer disturb the fading panel.
    const handleOwnOverlayTransition = (event: TransitionEvent): void => {
      if (event.propertyName === "overlay") {
        promoteDevtoolsTopLayer(topLayerElement);
      }
    };

    // Keyboard events leave the shadow root retargeted to its host, so host shortcuts cannot tell that a devtools
    // field or control has focus: a page that toggles video playback on Space cancels the key, which swallows a
    // typed space and keeps a focused devtools button from activating. Every key pressed in devtools ends its
    // propagation at the shadow root, after devtools listeners, including React's on the mount node and document
    // capture listeners, have handled it.
    const rootNode: Node = topLayerElement.getRootNode();
    const keyboardBoundary: ShadowRoot | null = rootNode instanceof ShadowRoot ? rootNode : null;
    const handleDevtoolsKeyboardEvent = (event: Event): void => {
      event.stopPropagation();
    };

    topLayerElement.showPopover();
    for (const type of KEYBOARD_EVENT_TYPES) {
      keyboardBoundary?.addEventListener(type, handleDevtoolsKeyboardEvent);
    }
    ownerDocument.addEventListener("toggle", handleHostToggle, true);
    topLayerElement.addEventListener("toggle", handleOwnTopLayerChange, true);
    topLayerElement.addEventListener("transitionend", handleOwnOverlayTransition);
    topLayerElement.addEventListener("transitioncancel", handleOwnOverlayTransition);

    return () => {
      for (const type of KEYBOARD_EVENT_TYPES) {
        keyboardBoundary?.removeEventListener(type, handleDevtoolsKeyboardEvent);
      }
      ownerDocument.removeEventListener("toggle", handleHostToggle, true);
      topLayerElement.removeEventListener("toggle", handleOwnTopLayerChange, true);
      topLayerElement.removeEventListener("transitionend", handleOwnOverlayTransition);
      topLayerElement.removeEventListener("transitioncancel", handleOwnOverlayTransition);

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
      data-devhost-native-instance={nativeBrowserBinding?.instanceId}
      data-devhost-native-document={nativeBrowserBinding?.documentId}
      data-testid="DevtoolsTopLayer"
      popover="manual"
    >
      {children}
    </div>
  );
}
