import { useId, useLayoutEffect, useRef, useState, type JSX } from "react";

import { App as DevtoolsApp } from "../src/devtools/components/App";
import {
  hostLayerStyles,
  HostShadowPopover,
  renderDevtoolsInStoryShadowRoot,
} from "../src/devtools/shared/components/stories/helpers";

type ReactHighlightHostLayer = "popover" | "shadow-popover" | "stacking-context";

interface IReactHighlightLayeringSceneProps {
  hostLayer?: ReactHighlightHostLayer;
}

export const cursorTargetShadowPopoverTestId: string = "CursorTargetShadowPopover";

export function ReactHighlightLayeringScene({
  hostLayer = "stacking-context",
}: IReactHighlightLayeringSceneProps): JSX.Element {
  const panelId = useId();
  const [clickCount, setClickCount] = useState<number>(0);
  const cursorTargetsReference = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = cursorTargetsReference.current;
    if (container === null) {
      return;
    }

    // Real host DOM nodes with source metadata fixtures; their geometry and popover behavior come from the browser.
    const targets = ["First cursor target", "Second cursor target"].map((name) => {
      const target = container.ownerDocument.createElement("button");
      target.type = "button";
      target.textContent = name;
      Reflect.set(target, "__reactFiber$cursorStory", {
        _debugSource: { fileName: "/storybook-workspace/src/CursorTargets.tsx", lineNumber: 10, columnNumber: 5 },
        memoizedProps: {},
        type: { name: "CursorTarget" },
      });
      target.addEventListener("click", () => setClickCount((value) => value + 1));
      container.append(target);
      return target;
    });

    return () => targets.forEach((target) => target.remove());
  }, []);

  const cursorTargets = (
    <>
      <div ref={cursorTargetsReference} style={{ display: "grid", gap: 20 }} />
      <output aria-label="Host clicks">{clickCount}</output>
    </>
  );

  return (
    <>
      {hostLayer === "shadow-popover" ? (
        <HostShadowPopover
          coverage="inset"
          openLabel="Open cursor target popover"
          testId={cursorTargetShadowPopoverTestId}
        >
          <section aria-label="Cursor targets">{cursorTargets}</section>
        </HostShadowPopover>
      ) : (
        <>
          {hostLayer === "popover" ? (
            <button type="button" popoverTarget={panelId}>
              Open cursor target popover
            </button>
          ) : null}
          <section
            id={panelId}
            popover={hostLayer === "popover" ? "auto" : undefined}
            aria-label="Cursor targets"
            style={hostLayerStyles.inset}
          >
            {cursorTargets}
          </section>
        </>
      )}
      <div style={{ position: "relative", zIndex: 0, transform: "translateZ(0)", contain: "paint", height: 1 }}>
        {renderDevtoolsInStoryShadowRoot(<DevtoolsApp />)}
      </div>
    </>
  );
}
