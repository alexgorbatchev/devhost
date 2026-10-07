import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, test, vi, type Mock } from "vitest";

import { addDevtoolsButton, addHostButton, readCenter } from "../../../../../../test-support/hostPageUtils";
import type { IWorktreeRepository } from "../../../../shared/types";
import type { ITerminalSessionStartResult } from "../../../terminalSessions/types";
import type { ComponentSourceMenuItem } from "../../types";
import { useComponentSourceNavigation } from "../useComponentSourceNavigation";
import { addComponentMenuItem, addInspectableButton, captureNavigations } from "./helpers";

type NavigationParams = Parameters<typeof useComponentSourceNavigation>[0];
type StartComponentSourceSession = NavigationParams["startComponentSourceSession"];
type WriteClipboardText = Clipboard["writeText"];

// The stack runs from `/projects/shop`, where the page's source metadata points.
const repository: IWorktreeRepository = {
  configuredPath: "/projects/shop",
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

/** Alt+right-clicks the center of `element` and reports whether the browser would still show its own menu. */
async function inspect(element: Element): Promise<boolean> {
  let isDefaultAllowed: boolean = true;

  // Component inspection resolves through promises, so the menu appears after the event.
  await act(async (): Promise<void> => {
    isDefaultAllowed = fireEvent.contextMenu(element, { altKey: true, ...readCenter(element) });
  });

  return isDefaultAllowed;
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

    expect(hook.result.current.componentMenu).toBeNull();
    expect(await inspect(saveButton)).toBe(false);

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

    await inspect(saveButton);
    expect(hook.result.current.componentMenu).not.toBeNull();

    expect(fireEvent.contextMenu(saveButton, readCenter(saveButton))).toBe(true);
    expect(hook.result.current.componentMenu).toBeNull();
  });

  test("opens no menu inside devtools, for an element without component source, or while disabled", async () => {
    const devtoolsButton: HTMLButtonElement = addDevtoolsButton({ height: 20, width: 60, x: 400, y: 300 });
    const plainButton: HTMLButtonElement = addHostButton("plain", "Plain", { height: 20, width: 60, x: 600, y: 300 });
    const hook = renderNavigation();

    expect(await inspect(devtoolsButton)).toBe(true);
    expect(hook.result.current.componentMenu).toBeNull();

    expect(await inspect(plainButton)).toBe(false);
    expect(hook.result.current.componentMenu).toBeNull();

    // Nothing but the page itself is under the pointer here.
    await act(async (): Promise<void> => {
      fireEvent.contextMenu(document.body, { altKey: true, clientX: 20, clientY: 700 });
    });
    expect(hook.result.current.componentMenu).toBeNull();

    hook.unmount();
    const disabledHook = renderNavigation({ enabled: false });

    expect(await inspect(saveButton)).toBe(true);
    expect(disabledHook.result.current.componentMenu).toBeNull();
  });

  test("closes the menu on Escape or a press outside it, but not on a press inside it", async () => {
    const menuItem: HTMLButtonElement = addComponentMenuItem({ height: 20, width: 120, x: 140, y: 80 });
    const terminalInput: HTMLTextAreaElement = document.createElement("textarea");
    const hook = renderNavigation();

    terminalInput.className = "xterm-helper-textarea";
    document.body.append(terminalInput);

    await inspect(saveButton);
    fireEvent.mouseDown(menuItem);
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(terminalInput, { key: "Escape" });
    expect(hook.result.current.componentMenu).not.toBeNull();

    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    expect(hook.result.current.componentMenu).toBeNull();

    await inspect(saveButton);
    fireEvent.mouseDown(saveButton);
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
