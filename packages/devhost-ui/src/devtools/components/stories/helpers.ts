import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  clearReactHighlightOverlays,
  highlightReactElements,
} from "../../features/reactHighlight/reactHighlightOverlay";
import {
  devtoolsStoryShadowRootHostTestId,
  expectDevtoolsSurfaceAbove,
  expectDevtoolsSurfaceOnTop,
  readDevtoolsStoryShadowCanvas,
  readShadowRoot,
} from "../../shared/components/stories/helpers";
import type { IHighlightOverlayRectangle } from "../../shared/components/HighlightOverlay";
import { RESTART_SERVICE_PATH } from "../../shared/constants";

type FetchRequestInput = Parameters<typeof fetch>[0];
type FetchRequestInit = Parameters<typeof fetch>[1];

export async function verifySurfaceOrder(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const shadowRoot = readShadowRoot(
    canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
    "Missing story shadow root.",
  );
  const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
  const minimap = await shadowCanvas.findByTestId("LogMinimap");
  await within(toolbar).findByRole("button", { name: /^Pi terminal, / });
  const cornerTarget = canvas.getByRole("button", { name: "Corner target" });
  const cornerRectangle = cornerTarget.getBoundingClientRect();
  // One session keeps the Alt key state between calls, so releasing it dispatches the keyup that ends selection.
  const user = userEvent.setup();

  await user.keyboard("{Alt>}");
  // Selection resolves its target from the pointer position, which a synthetic click only carries when given.
  await user.pointer({
    coords: {
      clientX: cornerRectangle.left + cornerRectangle.width / 2,
      clientY: cornerRectangle.top + cornerRectangle.height / 2,
    },
    keys: "[MouseLeft]",
    target: cornerTarget,
  });
  await user.keyboard("{/Alt}");

  const annotationDraft = await shadowCanvas.findByRole("dialog", { name: "Annotation draft" });
  await waitFor(() => {
    expectDevtoolsSurfaceAbove(shadowRoot, toolbar, annotationDraft);
  });

  await user.click(within(toolbar).getByRole("button", { name: /^Pi terminal, / }));
  const terminal = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });
  // Hovered, the minimap widens from its edge strip into the area a fullscreen terminal covers.
  await user.hover(minimap);
  await waitFor(() => {
    expectDevtoolsSurfaceAbove(shadowRoot, terminal, annotationDraft);
    expectDevtoolsSurfaceAbove(shadowRoot, terminal, toolbar);
    expectDevtoolsSurfaceAbove(shadowRoot, terminal, minimap);
  });
}

export async function verifySelectionLayering(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const shadowRoot = readShadowRoot(
    canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
    "Missing story shadow root.",
  );
  const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
  const minimap = await shadowCanvas.findByTestId("LogMinimap");
  await within(toolbar).findByRole("button", { name: /^Pi terminal, / });
  // One session keeps the Alt key state between calls, so releasing it dispatches the keyup that ends selection.
  const user = userEvent.setup();

  await user.keyboard("{Alt>}");
  await user.click(canvas.getByRole("button", { name: "Viewport target" }));
  await user.keyboard("{/Alt}");

  const annotationDraft = await shadowCanvas.findByRole("dialog", { name: "Annotation draft" });
  const selectionHighlight = await shadowCanvas.findByTestId("AnnotationComposer--selection-highlight");
  const expectAboveSelection = (surface: HTMLElement): void => {
    const rectangle = surface.getBoundingClientRect();
    // Include the passive highlight in native hit testing only while checking the browser's paint order.
    selectionHighlight.style.pointerEvents = "auto";
    try {
      const topElement = shadowRoot.elementFromPoint(
        rectangle.left + rectangle.width / 2,
        rectangle.top + rectangle.height / 2,
      );
      expect(surface.contains(topElement)).toBe(true);
    } finally {
      selectionHighlight.style.removeProperty("pointer-events");
    }
  };

  await waitFor(() => {
    expectAboveSelection(annotationDraft);
    expectAboveSelection(toolbar);
    expectAboveSelection(minimap);
  });

  await user.click(within(toolbar).getByRole("button", { name: /^Pi terminal, / }));
  const terminal = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });
  await waitFor(() => {
    expectAboveSelection(terminal);
  });
  expect(selectionHighlight).toBeVisible();
}

export async function verifyDevtoolsClickDuringSelection(canvasElement: HTMLElement): Promise<void> {
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
  const terminalChip = await within(toolbar).findByRole("button", { name: /^Pi terminal, / });
  const chipRectangle = terminalChip.getBoundingClientRect();
  // One session keeps the Alt key state between calls, so releasing it dispatches the keyup that ends selection.
  const user = userEvent.setup();

  await user.keyboard("{Alt>}");
  const selectionHint = await shadowCanvas.findByRole("status", { name: "Annotation selection" });
  // Selection resolves its target from the pointer position, which a synthetic click only carries when given.
  await user.pointer({
    coords: {
      clientX: chipRectangle.left + chipRectangle.width / 2,
      clientY: chipRectangle.top + chipRectangle.height / 2,
    },
    keys: "[MouseLeft]",
    target: terminalChip,
  });

  const terminal = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });
  await waitFor(() => {
    expect(terminal).toBeVisible();
  });
  // The page element beneath the toolbar stays unmarked, so selection is still waiting for its first target.
  expect(selectionHint).toBeVisible();
  expect(shadowCanvas.queryByRole("dialog", { name: "Annotation draft" })).toBeNull();

  await user.keyboard("{/Alt}");
}

export async function verifyRestartShortcut(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  // The shortcut chooses its services from the health snapshot, so wait for it to arrive.
  await shadowCanvas.findByRole("button", { name: "Services: 2 of 3 up" });
  const originalFetch = globalThis.fetch;
  const requestFetch = fn(async (input: FetchRequestInput, init?: FetchRequestInit): Promise<Response> => {
    return input === RESTART_SERVICE_PATH ? new Response(null, { status: 204 }) : originalFetch(input, init);
  });
  const readRestartRequests = (): typeof requestFetch.mock.calls => {
    return requestFetch.mock.calls.filter(([input]) => input === RESTART_SERVICE_PATH);
  };
  // One session keeps the modifier key state between calls.
  const user = userEvent.setup();

  Reflect.set(globalThis, "fetch", requestFetch);
  try {
    await user.click(canvas.getByRole("textbox", { name: "Host field" }));
    await user.keyboard("{Alt>}{Control>}r{/Control}{/Alt}");
    expect(readRestartRequests()).toEqual([]);

    await user.click(canvas.getByRole("textbox", { name: "Host note" }));
    await user.keyboard("{Alt>}{Control>}r{/Control}{/Alt}");
    expect(readRestartRequests()).toEqual([]);

    await user.click(await shadowCanvas.findByRole("button", { name: /^Pi terminal, / }));
    const terminal = await shadowCanvas.findByRole("dialog", { name: "Pi terminal" });
    await user.click(await within(terminal).findByRole("textbox", { name: "Terminal input" }));
    await user.keyboard("{Alt>}{Control>}r{/Control}{/Alt}");
    expect(readRestartRequests()).toEqual([]);
    await user.click(within(terminal).getByRole("button", { name: "Minimize" }));

    await user.click(canvas.getByRole("button", { name: "Host button" }));
    await user.keyboard("{Alt>}{Control>}r{/Control}{/Alt}");
    expect(readRestartRequests()).toEqual([
      [
        RESTART_SERVICE_PATH,
        { body: '{"serviceNames":["app"]}', headers: { "content-type": "application/json" }, method: "POST" },
      ],
    ]);
  } finally {
    Reflect.set(globalThis, "fetch", originalFetch);
  }
}

export async function verifyReactHighlightLayering(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const appRoot = await shadowCanvas.findByTestId("DevtoolsTopLayer");
  const shadowRoot = readShadowRoot(
    canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
    "Missing story shadow root.",
  );
  const targets = [
    canvas.getByRole("button", { name: "First cursor target" }),
    canvas.getByRole("button", { name: "Second cursor target" }),
  ];
  const diagnostics: unknown[] = [];
  const recordDiagnostic = (event: Event): void => {
    diagnostics.push(Reflect.get(event, "detail"));
  };
  window.addEventListener("devhost:react-highlight", recordDiagnostic);

  try {
    const overlays = await highlightReactElements("src/CursorTargets.tsx:10:5", "/storybook-workspace", appRoot);
    try {
      expect(overlays).toHaveLength(2);
      expect(diagnostics).toEqual([{ locator: "src/CursorTargets.tsx:10:5", matchedCount: 2 }]);

      const readRectangle = (element: HTMLElement): IHighlightOverlayRectangle => {
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      };
      const targetRectangles = targets.map(readRectangle).sort((a, b) => a.y - b.y);
      const overlayRectangles = overlays.map(({ overlay }) => readRectangle(overlay)).sort((a, b) => a.y - b.y);
      expect(overlayRectangles).toEqual(targetRectangles);

      for (const { overlay } of overlays) {
        expect(overlay.parentElement).toBe(appRoot);
        expectDevtoolsSurfaceOnTop(shadowRoot, overlay);
      }

      await userEvent.click(canvas.getByRole("button", { name: "First cursor target" }));
      expect(canvas.getByRole("status", { name: "Host clicks" })).toHaveTextContent("1");
      expect(document.activeElement).toBe(canvas.getByRole("button", { name: "First cursor target" }));
    } finally {
      clearReactHighlightOverlays(overlays);
    }

    for (const { overlay } of overlays) {
      expect(overlay.isConnected).toBe(false);
    }
    clearReactHighlightOverlays(overlays);
    const nextOverlays = await highlightReactElements("src/CursorTargets.tsx:10:5", "/storybook-workspace", appRoot);
    try {
      expect(nextOverlays).toHaveLength(2);
      for (const { overlay } of nextOverlays) {
        expectDevtoolsSurfaceOnTop(shadowRoot, overlay);
      }
    } finally {
      clearReactHighlightOverlays(nextOverlays);
    }
  } finally {
    window.removeEventListener("devhost:react-highlight", recordDiagnostic);
  }
}
