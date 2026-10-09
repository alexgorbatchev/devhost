import { act, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, onTestFinished, test, vi, type Mock } from "vitest";
import { userEvent } from "vitest/browser";

import { addDevtoolsButton, addHostButton, placeElement } from "../../../../../../test-support/hostPageUtils";
import type { IWorktreeRepository } from "../../../../shared/types";
import type { ITerminalSessionStartResult } from "../../../terminalSessions/types";
import type { ComponentSourceMenuItem } from "../../types";
import { useComponentSourceNavigation } from "../useComponentSourceNavigation";
import { addComponentMenuItem, addInspectableButton, captureNavigations } from "./helpers";

type NavigationParams = Parameters<typeof useComponentSourceNavigation>[0];
type StartComponentSourceSession = NavigationParams["startComponentSourceSession"];
type WriteClipboardText = Clipboard["writeText"];
type CanceledEventType = "contextmenu" | "keydown";

// The stack runs from `/projects/shop`, where the page's source metadata points.
const repository: IWorktreeRepository = {
  configuredPath: "/projects/shop",
  defaultBranch: "main",
  id: "shop",
  name: "shop",
  runningPath: "/projects/shop",
  selectedPath: "/projects/shop",
  serviceNames: ["web"],
  switching: false,
  worktrees: [],
};

let saveButton: HTMLButtonElement;
let startComponentSourceSession: Mock<StartComponentSourceSession>;
let writeClipboardText: Mock<WriteClipboardText>;

function navigationParams(overrides: Partial<NavigationParams> = {}): NavigationParams {
  return {
    componentEditor: "vscode",
    projectRootPath: "/projects/shop",
    startComponentSourceSession,
    ...overrides,
  };
}

function renderNavigation(overrides: Partial<NavigationParams> = {}) {
  return renderHook((props: NavigationParams) => useComponentSourceNavigation(props), {
    initialProps: navigationParams(overrides),
  });
}

// The pointer and the keyboard are the browser's own: the page receives what a person's input produces. Component
// inspection resolves through promises, so each input runs inside `act`.

/** Alt+right-clicks the center of `element`, the gesture that inspects a component. */
async function inspect(element: Element): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.click(element, { button: "right", modifiers: ["Alt"] });
  });
}

async function rightClick(element: Element): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.click(element, { button: "right" });
  });
}

async function click(element: Element): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.click(element);
  });
}

async function pressKey(key: string): Promise<void> {
  await act(async (): Promise<void> => {
    await userEvent.keyboard(`{${key}}`);
  });
}

/**
 * Records, for each `type` event from now on, whether the hook kept the browser from acting on it: showing its own
 * menu for a right-click, or handling a key. The page listens where the hook does, after it, so call this once the
 * hook's listener for `type` is in place.
 */
function recordCancellations(type: CanceledEventType): boolean[] {
  const cancellations: boolean[] = [];
  const listening = new AbortController();

  document.addEventListener(
    type,
    (event: Event): void => {
      cancellations.push(event.defaultPrevented);
    },
    { capture: true, signal: listening.signal },
  );
  onTestFinished((): void => listening.abort());

  return cancellations;
}

beforeEach(() => {
  saveButton = addInspectableButton({ height: 20, width: 80, x: 100, y: 50 });
  startComponentSourceSession = vi.fn<StartComponentSourceSession>(
    async (): Promise<ITerminalSessionStartResult> => ({ success: true }),
  );
  // Headless Chromium refuses clipboard writes from a page that does not have focus.
  writeClipboardText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useComponentSourceNavigation", () => {
  test("opens a menu of the component and its owners for the element under an Alt+right-click", async () => {
    const hook = renderNavigation();
    const cancellations: boolean[] = recordCancellations("contextmenu");

    expect(hook.result.current.componentMenu).toBeNull();
    await inspect(saveButton);
    expect(cancellations).toEqual([true]);

    expect(hook.result.current.componentMenu).toEqual({
      items: [
        {
          action: {
            kind: "external-editor",
            sourceUrl: "vscode://file//projects/shop/src/components/Button.tsx:48:9",
          },
          displayName: "Button",
          key: "src/components/Button.tsx:48:9:0",
          props: [
            { name: "disabled", title: "disabled=false" },
            { name: "label", title: "label=Save" },
          ],
          source: {
            columnNumber: 9,
            componentName: "Button",
            fileName: "/projects/shop/src/components/Button.tsx",
            lineNumber: 48,
          },
          sourceLabel: "src/components/Button.tsx:48:9",
        },
        {
          action: { kind: "external-editor", sourceUrl: "vscode://file//projects/shop/src/Toolbar.tsx:18:3" },
          displayName: "Toolbar",
          key: "src/Toolbar.tsx:18:3:1",
          props: [{ name: "variant", title: "variant=primary" }],
          source: {
            columnNumber: 3,
            componentName: "Toolbar",
            fileName: "/projects/shop/src/Toolbar.tsx",
            lineNumber: 18,
          },
          sourceLabel: "src/Toolbar.tsx:18:3",
        },
      ],
      title: "Open in VS Code",
      x: 140,
      y: 60,
    });
  });

  test("leaves a right-click without Alt to the page and closes an open menu", async () => {
    const hook = renderNavigation();

    const cancellations: boolean[] = recordCancellations("contextmenu");

    await inspect(saveButton);
    expect(hook.result.current.componentMenu).not.toBeNull();

    await rightClick(saveButton);
    expect(cancellations).toEqual([true, false]);
    expect(hook.result.current.componentMenu).toBeNull();

    // The menu key asks for the browser's menu without a press on anything.
    await inspect(saveButton);
    expect(hook.result.current.componentMenu).not.toBeNull();
    await pressKey("ContextMenu");
    expect(cancellations).toEqual([true, false, true, false]);
    expect(hook.result.current.componentMenu).toBeNull();
  });

  test("opens no menu inside devtools, for an element without component source, or while disabled", async () => {
    const devtoolsButton: HTMLButtonElement = addDevtoolsButton({ height: 20, width: 60, x: 400, y: 300 });
    const plainButton: HTMLButtonElement = addHostButton("plain", "Plain", { height: 20, width: 60, x: 600, y: 300 });
    const hook = renderNavigation();
    const cancellations: boolean[] = recordCancellations("contextmenu");

    await inspect(devtoolsButton);
    expect(cancellations).toEqual([false]);
    expect(hook.result.current.componentMenu).toBeNull();

    await inspect(plainButton);
    expect(cancellations).toEqual([false, true]);
    expect(hook.result.current.componentMenu).toBeNull();

    // Nothing but the page itself is under the pointer here.
    Object.assign(document.body.style, { margin: "0", minHeight: "100vh" });
    onTestFinished((): void => document.body.removeAttribute("style"));
    await act(async (): Promise<void> => {
      await userEvent.click(document.body, { button: "right", modifiers: ["Alt"], position: { x: 20, y: 700 } });
    });
    expect(cancellations).toEqual([false, true, true]);
    expect(hook.result.current.componentMenu).toBeNull();

    hook.unmount();
    const disabledHook = renderNavigation({ enabled: false });

    await inspect(saveButton);
    expect(cancellations).toEqual([false, true, true, false]);
    expect(disabledHook.result.current.componentMenu).toBeNull();
  });

  test("closes the menu on Escape or a press outside it, but not on a press inside it", async () => {
    const menuItem: HTMLButtonElement = addComponentMenuItem({ height: 20, width: 120, x: 140, y: 80 });
    const terminalInput: HTMLTextAreaElement = document.createElement("textarea");
    const hook = renderNavigation();

    terminalInput.className = "xterm-helper-textarea";
    placeElement(terminalInput, { height: 40, width: 200, x: 600, y: 400 });
    document.body.append(terminalInput);

    await inspect(saveButton);

    const cancellations: boolean[] = recordCancellations("keydown");

    await click(menuItem);
    await pressKey("Enter");
    // A terminal takes the focus without a press, and Escape belongs to the program running in it.
    terminalInput.focus();
    await pressKey("Escape");
    expect(cancellations).toEqual([false, false]);
    expect(hook.result.current.componentMenu).not.toBeNull();

    terminalInput.blur();
    await pressKey("Escape");
    expect(cancellations).toEqual([false, false, true]);
    expect(hook.result.current.componentMenu).toBeNull();

    await inspect(saveButton);
    expect(hook.result.current.componentMenu).not.toBeNull();
    await click(saveButton);
    expect(hook.result.current.componentMenu).toBeNull();

    // A press reaches the document without passing through any element only when a script dispatches it there. No
    // pointer can produce that, so the page's script is played here. It is outside the menu too.
    await inspect(saveButton);
    expect(hook.result.current.componentMenu).not.toBeNull();
    act((): void => {
      document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(hook.result.current.componentMenu).toBeNull();
  });

  test("closes the menu when the selected worktree changes", async () => {
    const hook = renderNavigation({ worktreeRepository: repository });

    await inspect(saveButton);
    expect(hook.result.current.componentMenu).not.toBeNull();

    hook.rerender(navigationParams({ worktreeRepository: { ...repository, selectedPath: "/worktrees/cart" } }));
    expect(hook.result.current.componentMenu).toBeNull();
  });

  test("points menu sources at the selected worktree", async () => {
    const hook = renderNavigation({ worktreeRepository: { ...repository, selectedPath: "/worktrees/cart" } });

    await inspect(saveButton);

    expect(
      hook.result.current.componentMenu?.items.map((item: ComponentSourceMenuItem): string => item.source.fileName),
    ).toEqual(["/worktrees/cart/src/components/Button.tsx", "/worktrees/cart/src/Toolbar.tsx"]);
  });

  test("openComponentSource copies the source path, navigates to the editor URL, and closes the menu", async () => {
    const navigations: string[] = captureNavigations();
    const hook = renderNavigation();

    await inspect(saveButton);
    await act(() => hook.result.current.openComponentSource(1));

    expect(writeClipboardText.mock.calls).toEqual([["src/Toolbar.tsx:18:3"]]);
    expect(navigations).toEqual(["vscode://file//projects/shop/src/Toolbar.tsx:18:3"]);
    expect(startComponentSourceSession).toHaveBeenCalledTimes(0);
    expect(hook.result.current.componentMenu).toBeNull();
  });

  test("openComponentSource still navigates when the clipboard refuses the copy", async () => {
    const navigations: string[] = captureNavigations();
    const hook = renderNavigation();

    writeClipboardText.mockRejectedValueOnce(new DOMException("Document is not focused.", "NotAllowedError"));
    await inspect(saveButton);
    await act(() => hook.result.current.openComponentSource(0));

    expect(navigations).toEqual(["vscode://file//projects/shop/src/components/Button.tsx:48:9"]);
    expect(hook.result.current.componentMenu).toBeNull();
  });

  test("openComponentSource starts a session for the Neovim editor and closes the menu", async () => {
    const navigations: string[] = captureNavigations();
    const hook = renderNavigation({ componentEditor: "neovim" });

    await inspect(saveButton);
    expect(hook.result.current.componentMenu?.title).toBe("Open in Neovim");

    const menuItem: ComponentSourceMenuItem | undefined = hook.result.current.componentMenu?.items[0];

    assert(menuItem !== undefined);
    expect(menuItem.action).toEqual({ kind: "neovim" });
    await act(() => hook.result.current.openComponentSource(0));

    expect(startComponentSourceSession.mock.calls).toEqual([[menuItem]]);
    expect(navigations).toEqual([]);
    expect(hook.result.current.componentMenu).toBeNull();
  });

  test("openComponentSource keeps the menu open and shows why a Neovim session did not start", async () => {
    const hook = renderNavigation({ componentEditor: "neovim" });

    startComponentSourceSession.mockResolvedValueOnce({ errorMessage: "nvim is not installed.", success: false });
    await inspect(saveButton);
    await act(() => hook.result.current.openComponentSource(0));
    expect(hook.result.current.componentMenu?.errorMessage).toBe("nvim is not installed.");

    startComponentSourceSession.mockResolvedValueOnce({ success: false });
    await act(() => hook.result.current.openComponentSource(0));
    expect(hook.result.current.componentMenu?.errorMessage).toBe("Failed to start the Neovim session.");
    expect(hook.result.current.componentMenu?.items).toHaveLength(2);
  });

  test("openComponentSource ignores an index the menu does not have", async () => {
    const navigations: string[] = captureNavigations();
    const hook = renderNavigation();

    await act(() => hook.result.current.openComponentSource(0));
    await inspect(saveButton);
    await act(() => hook.result.current.openComponentSource(5));

    expect(navigations).toEqual([]);
    expect(hook.result.current.componentMenu).not.toBeNull();
  });
});
