import { describe, expect, test } from "bun:test";

import {
  areExternalDevtoolsLaunchersEqual,
  readExternalDevtoolsLauncherStyleText,
  readInstalledExternalDevtoolsLaunchers,
} from "../externalDevtoolsState";
import type { IExternalDevtoolsAdapter } from "../types";

describe("externalDevtoolsState", () => {
  test("reads installed launchers with open state", () => {
    const launchers = readInstalledExternalDevtoolsLaunchers([
      createAdapter({ id: "query", isInstalled: true, isOpen: true, label: "Query" }),
      createAdapter({ id: "router", isInstalled: false, isOpen: false, label: "Router" }),
    ]);

    expect(launchers).toEqual([
      {
        id: "query",
        isOpen: true,
        label: "Query",
        title: "Query title",
      },
    ]);
  });

  test("builds a single selector-based hide rule", () => {
    expect(
      readExternalDevtoolsLauncherStyleText([
        createAdapter({ id: "query", hideSelectors: [".tsqd-open-btn", ".tsqd-minimize-btn"] }),
        createAdapter({ id: "router", hideSelectors: ["footer.TanStackRouterDevtools > button"] }),
      ]),
    ).toBe(".tsqd-open-btn, .tsqd-minimize-btn, footer.TanStackRouterDevtools > button { display: none !important; }");
  });

  test("compares launcher arrays by identity and open state", () => {
    expect(
      areExternalDevtoolsLaunchersEqual(
        [{ id: "query", isOpen: false, label: "Query", title: "Query title" }],
        [{ id: "query", isOpen: false, label: "Query", title: "Query title" }],
      ),
    ).toBe(true);

    expect(
      areExternalDevtoolsLaunchersEqual(
        [{ id: "query", isOpen: false, label: "Query", title: "Query title" }],
        [{ id: "query", isOpen: true, label: "Query", title: "Query title" }],
      ),
    ).toBe(false);
  });
});

function createAdapter({
  hideSelectors = [],
  id,
  isInstalled = true,
  isOpen = false,
  label = id,
}: {
  hideSelectors?: string[];
  id: string;
  isInstalled?: boolean;
  isOpen?: boolean;
  label?: string;
}): IExternalDevtoolsAdapter {
  return {
    close: (): void => {},
    hideSelectors,
    id,
    isInstalled: (): boolean => isInstalled,
    isOpen: (): boolean => isOpen,
    label,
    open: (): void => {},
    title: `${label} title`,
  };
}
