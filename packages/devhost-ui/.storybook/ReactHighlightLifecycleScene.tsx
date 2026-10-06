import { useRef, useState, useSyncExternalStore, type JSX } from "react";

import { useReactHighlightOverlay } from "../src/devtools/features/reactHighlight/hooks/useReactHighlightOverlay";
import { ReactHighlightLifecycleController } from "./ReactHighlightLifecycleController";

interface IReactHighlightLifecycleSceneProps {
  initialEnabled?: boolean;
  isDeferred?: boolean;
}

type ReactHighlightHookProbeProps = Parameters<typeof useReactHighlightOverlay>[0];

function ReactHighlightHookProbe(props: ReactHighlightHookProbeProps): null {
  useReactHighlightOverlay(props);
  return null;
}

export function ReactHighlightLifecycleScene({
  initialEnabled = true,
  isDeferred = false,
}: IReactHighlightLifecycleSceneProps): JSX.Element {
  const [controller] = useState(() => new ReactHighlightLifecycleController(isDeferred));
  const [isEnabled, setIsEnabled] = useState<boolean>(initialEnabled);
  const [isMounted, setIsMounted] = useState<boolean>(true);
  const [hasOverlayRoot, setHasOverlayRoot] = useState<boolean>(true);
  const [projectRootPath, setProjectRootPath] = useState<string>("/configured-project");
  const overlayRootReference = useRef<HTMLDivElement | null>(null);
  const missingRootReference = useRef<HTMLElement | null>(null);
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  const probe = isMounted ? (
    <ReactHighlightHookProbe
      createWebSocket={controller.createWebSocket}
      enabled={isEnabled}
      highlightElements={controller.highlightElements}
      overlayRootReference={hasOverlayRoot ? overlayRootReference : missingRootReference}
      projectRootPath={projectRootPath}
    />
  ) : null;

  return (
    <section data-testid="ReactHighlightLifecycleScene" aria-label="Cursor hook lifecycle">
      <label>
        <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />
        Enabled
      </label>
      <button type="button" onClick={() => setProjectRootPath("/other-project")}>
        Switch project
      </button>
      <button type="button" onClick={() => setIsMounted((value) => !value)}>
        {isMounted ? "Unmount hook" : "Mount hook"}
      </button>
      <button type="button" onClick={() => setHasOverlayRoot((value) => !value)}>
        Toggle overlay root
      </button>
      <button type="button" onClick={() => controller.sendCursor("src/First.tsx:10:5")}>
        First cursor
      </button>
      <button type="button" onClick={() => controller.sendCursor("src/Second.tsx:20:5")}>
        Second cursor
      </button>
      <button type="button" onClick={() => controller.sendCursor("src/First.tsx:10:5", "")}>
        Cursor with fallback root
      </button>
      <button type="button" onClick={() => controller.sendCursor(null)}>
        Clear cursor
      </button>
      <button type="button" onClick={() => controller.sendInvalidMessages()}>
        Invalid messages
      </button>
      <button type="button" onClick={() => controller.sendCursor("src/First.tsx:10:5", "", 0)}>
        Old socket message
      </button>
      {isDeferred ? (
        <>
          <button type="button" onClick={() => controller.resolveRequest(0)}>
            Resolve first request
          </button>
          <button type="button" onClick={() => controller.resolveRequest(1)}>
            Resolve second request
          </button>
        </>
      ) : null}
      <output aria-label="Connections">{controller.sockets.length}</output>
      <output aria-label="Closed connections">
        {controller.sockets.reduce((count, socket) => count + socket.closeCount, 0)}
      </output>
      <output aria-label="Socket URLs">{JSON.stringify(controller.sockets.map((socket) => socket.url))}</output>
      <output aria-label="Highlight requests">
        {JSON.stringify(
          controller.requests.map(({ locator, projectRootPath: root }) => ({ locator, projectRootPath: root })),
        )}
      </output>
      <output aria-label="Request count">{controller.requests.length}</output>
      <output aria-label="Resolved requests">
        {controller.requests.filter((request) => request.isResolved).length}
      </output>
      <div ref={overlayRootReference} data-testid="ReactHighlightLifecycleScene--overlay-root" />
      {probe}
    </section>
  );
}
