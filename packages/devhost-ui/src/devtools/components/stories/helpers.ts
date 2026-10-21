import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  clearReactHighlightOverlays,
  highlightReactElements,
} from "../../features/reactHighlight/reactHighlightOverlay";
import {
  devtoolsStoryShadowRootHostTestId,
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
  const target = canvas.getByRole("button", { name: "Corner target" });
  const rectangle = target.getBoundingClientRect();
  const user = userEvent.setup();
  await user.keyboard("{Alt>}");
  await user.pointer({
    coords: { clientX: rectangle.left + rectangle.width / 2, clientY: rectangle.top + rectangle.height / 2 },
    keys: "[MouseLeft]",
    target,
  });
  await user.keyboard("{/Alt}");
  const chat = await shadowCanvas.findByRole("complementary", { name: "Agent chat" });
  await waitFor(() => {
    expectDevtoolsSurfaceOnTop(shadowRoot, chat);
    expectDevtoolsSurfaceOnTop(shadowRoot, toolbar);
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
  const user = userEvent.setup();
  await user.keyboard("{Alt>}");
  await user.click(canvas.getByRole("button", { name: "Viewport target" }));
  await user.keyboard("{/Alt}");
  const chat = await shadowCanvas.findByRole("complementary", { name: "Agent chat" });
  const highlight = await shadowCanvas.findByTestId("AnnotationSelectionOverlay--selection-highlight");
  highlight.style.pointerEvents = "auto";
  try {
    await waitFor(() => {
      expectDevtoolsSurfaceOnTop(shadowRoot, chat);
      expectDevtoolsSurfaceOnTop(shadowRoot, toolbar);
    });
  } finally {
    highlight.style.removeProperty("pointer-events");
  }
  expect(highlight).toBeVisible();
}

export async function verifyDevtoolsClickDuringSelection(canvasElement: HTMLElement): Promise<void> {
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const toolbar = await shadowCanvas.findByRole("toolbar", { name: "devhost" });
  const button = await within(toolbar).findByRole("button", { name: "Chat" });
  const rectangle = button.getBoundingClientRect();
  const user = userEvent.setup();
  await user.keyboard("{Alt>}");
  await user.pointer({
    coords: { clientX: rectangle.left + rectangle.width / 2, clientY: rectangle.top + rectangle.height / 2 },
    keys: "[MouseLeft]",
    target: button,
  });
  await expect(await shadowCanvas.findByRole("complementary", { name: "Agent chat" })).toBeVisible();
  expect(shadowCanvas.queryByRole("region", { name: "Page context" })).toBeNull();
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

    await user.click(await shadowCanvas.findByRole("button", { name: "Chat" }));
    const chat = await shadowCanvas.findByRole("complementary", { name: "Agent chat" });
    await user.click(await within(chat).findByRole("textbox"));
    await user.keyboard("{Alt>}{Control>}r{/Control}{/Alt}");
    expect(readRestartRequests()).toEqual([]);
    await user.click(within(chat).getByRole("button", { name: "Collapse Chat" }));

    await user.click(canvas.getByRole("button", { name: "Host button" }));
    await user.keyboard("{Alt>}{Control>}r{/Control}{/Alt}");
    expect(readRestartRequests()).toEqual([
      [
        RESTART_SERVICE_PATH,
        { body: '{"serviceNames":["app"]}', headers: { "content-type": "application/json" }, method: "POST" },
      ],
    ]);
    await user.click(shadowCanvas.getByRole("button", { name: "Services: 2 of 3 up" }));
    const changed = await shadowCanvas.findByRole("button", { name: "Restart Changed" });
    await waitFor(() => expect(changed).toBeVisible());
    await user.click(changed);
    expect(readRestartRequests()).toEqual([
      [
        RESTART_SERVICE_PATH,
        { body: '{"serviceNames":["app"]}', headers: { "content-type": "application/json" }, method: "POST" },
      ],
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
