import { act, renderHook, waitFor } from "@testing-library/react";
import { assert, describe, expect, test, vi } from "vitest";

import { waitForAnimationFrame } from "../../../../../../test-support/hostPageUtils";
import type { IExternalDevtoolsLauncher } from "../../types";
import { useExternalDevtoolsLaunchers } from "../useExternalDevtoolsLaunchers";
import {
  addTanStackDevtoolsShell,
  addTanStackRouterDevtools,
  readHiddenLauncherStyle,
  type ITanStackDevtoolsShell,
} from "./helpers";

type HostAction = () => void;

interface ILaunchersProps {
  enabled: boolean;
}

const closedTanStackLauncher: IExternalDevtoolsLauncher = {
  id: "tanstack-devtools",
  isOpen: false,
  label: "TanStack",
  title: "Toggle TanStack Devtools",
};
const openTanStackLauncher: IExternalDevtoolsLauncher = { ...closedTanStackLauncher, isOpen: true };
const closedRouterLauncher: IExternalDevtoolsLauncher = {
  id: "tanstack-router",
  isOpen: false,
  label: "Router",
  title: "Toggle TanStack Router devtools",
};

function renderLaunchers(enabled: boolean = true) {
  return renderHook((props: ILaunchersProps) => useExternalDevtoolsLaunchers(props.enabled), {
    initialProps: { enabled },
  });
}

// The hook notices page changes through a mutation observer and rereads the page on the next animation frame. The
// first frame lets the observer's report schedule that read; the second lets it run.
async function changeHostPage(change: HostAction): Promise<void> {
  await act(async (): Promise<void> => {
    change();
    await waitForAnimationFrame();
    await waitForAnimationFrame();
  });
}

describe("useExternalDevtoolsLaunchers", () => {
  test("lists the host page's devtools and hides the launchers they render themselves", () => {
    const shell = addTanStackDevtoolsShell();

    expect(getComputedStyle(shell.trigger).display).not.toBe("none");

    const hook = renderLaunchers();

    expect(hook.result.current.launchers).toEqual([closedTanStackLauncher]);
    expect(getComputedStyle(shell.trigger).display).toBe("none");
    expect(getComputedStyle(shell.closeButton).display).toBe("none");
    expect(getComputedStyle(shell.panel).display).not.toBe("none");
  });

  test("lists nothing and hides nothing on a page without devtools", () => {
    const hook = renderLaunchers();

    expect(hook.result.current.launchers).toEqual([]);
    expect(readHiddenLauncherStyle()?.textContent).toBe("");
  });

  test("toggleLauncher opens and closes the host panel through the page's own controls", () => {
    const shell = addTanStackDevtoolsShell();
    const hook = renderLaunchers();

    act(() => hook.result.current.toggleLauncher("tanstack-devtools"));
    expect(shell.panel.getAttribute("data-open")).toBe("true");
    expect(hook.result.current.launchers).toEqual([openTanStackLauncher]);

    act(() => hook.result.current.toggleLauncher("tanstack-devtools"));
    expect(shell.panel.getAttribute("data-open")).toBe("false");
    expect(hook.result.current.launchers).toEqual([closedTanStackLauncher]);
    expect(shell.activationCount).toBe(2);
  });

  test("toggleLauncher reports the new state once a host that responds later has opened its panel", async () => {
    const pendingHostActions: HostAction[] = [];
    const shell = addTanStackDevtoolsShell((apply: HostAction): void => {
      pendingHostActions.push(apply);
    });
    const hook = renderLaunchers();

    act(() => hook.result.current.toggleLauncher("tanstack-devtools"));
    expect(hook.result.current.launchers).toEqual([closedTanStackLauncher]);

    await changeHostPage(() => {
      for (const apply of pendingHostActions) {
        apply();
      }
    });
    expect(shell.activationCount).toBe(1);
    expect(hook.result.current.launchers).toEqual([openTanStackLauncher]);
  });

  test("toggleLauncher keeps checking a panel that a CSS transition reveals without changing the page", async () => {
    addTanStackRouterDevtools();
    const hook = renderLaunchers();

    expect(hook.result.current.launchers).toEqual([closedRouterLauncher]);

    act(() => hook.result.current.toggleLauncher("tanstack-router"));
    // The page has changed and been reread, but the panel is not visible yet.
    await changeHostPage(() => {});
    expect(hook.result.current.launchers).toEqual([closedRouterLauncher]);

    await waitFor(() => {
      expect(hook.result.current.launchers).toEqual([{ ...closedRouterLauncher, isOpen: true }]);
    });
  });

  test("toggleLauncher ignores a launcher the page does not have", () => {
    const shell = addTanStackDevtoolsShell();
    const hook = renderLaunchers();

    act(() => hook.result.current.toggleLauncher("tanstack-query"));

    expect(shell.activationCount).toBe(0);
    expect(hook.result.current.launchers).toEqual([closedTanStackLauncher]);
  });

  test("follows devtools that mount, change state, and unmount after it started", async () => {
    const hook = renderLaunchers();
    const shells: ITanStackDevtoolsShell[] = [];

    expect(hook.result.current.launchers).toEqual([]);

    await changeHostPage(() => {
      shells.push(addTanStackDevtoolsShell());
    });

    const shell: ITanStackDevtoolsShell | undefined = shells.at(0);

    assert(shell !== undefined);
    expect(hook.result.current.launchers).toEqual([closedTanStackLauncher]);
    expect(getComputedStyle(shell.trigger).display).toBe("none");

    await changeHostPage(() => shell.panel.setAttribute("data-open", "true"));
    expect(hook.result.current.launchers).toEqual([openTanStackLauncher]);

    await changeHostPage(() => shell.root.remove());
    expect(hook.result.current.launchers).toEqual([]);
    expect(readHiddenLauncherStyle()?.textContent).toBe("");
  });

  test("lists nothing and stops hiding launchers while disabled, and resumes when enabled again", () => {
    const shell = addTanStackDevtoolsShell();
    const hook = renderLaunchers(false);

    expect(hook.result.current.launchers).toEqual([]);
    expect(readHiddenLauncherStyle()).toBeNull();
    expect(getComputedStyle(shell.trigger).display).not.toBe("none");

    hook.rerender({ enabled: true });
    expect(hook.result.current.launchers).toEqual([closedTanStackLauncher]);
    expect(getComputedStyle(shell.trigger).display).toBe("none");

    hook.rerender({ enabled: false });
    expect(hook.result.current.launchers).toEqual([]);
    expect(readHiddenLauncherStyle()).toBeNull();
    expect(getComputedStyle(shell.trigger).display).not.toBe("none");
  });

  test("stops hiding launchers and stops reading the page when it unmounts", async () => {
    const shell = addTanStackDevtoolsShell();
    const hook = renderLaunchers();

    hook.unmount();
    expect(readHiddenLauncherStyle()).toBeNull();
    expect(getComputedStyle(shell.trigger).display).not.toBe("none");

    const readPage = vi.spyOn(document, "querySelectorAll");

    await changeHostPage(() => shell.panel.setAttribute("data-open", "true"));
    expect(readPage).toHaveBeenCalledTimes(0);
    readPage.mockRestore();
  });
});
