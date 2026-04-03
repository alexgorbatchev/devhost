import { afterEach, describe, expect, test } from "bun:test";

import { inspectComponentElement } from "../inspectComponentElement";

type ReactFiberTestNode = {
  __source?: {
    columnNumber?: number;
    fileName: string;
    lineNumber: number;
  };
  _debugOwner?: ReactFiberTestNode | null;
  _debugSource?: {
    columnNumber?: number;
    fileName: string;
    lineNumber: number;
  };
  memoizedProps?: Record<string, unknown>;
  return?: ReactFiberTestNode | null;
  type?: {
    defaultProps?: Record<string, unknown>;
    displayName?: string;
    name?: string;
    render?: {
      displayName?: string;
      name?: string;
    };
    type?: {
      displayName?: string;
      name?: string;
    };
  } | null;
};

const originalWindow: unknown = Reflect.get(globalThis, "window");

function createElementWithFiber(fiber: ReactFiberTestNode): HTMLElement {
  const element: HTMLElement = {} as HTMLElement;

  Reflect.set(element, "__reactFiber$test", fiber);

  return element;
}

afterEach(() => {
  Reflect.set(globalThis, "window", originalWindow);
});

describe("inspectComponentElement", () => {
  test("returns deduplicated owner-chain component sources with primitive props", async () => {
    const ownerFiber: ReactFiberTestNode = {
      _debugSource: {
        columnNumber: 3,
        fileName: "/Users/test/project/src/Toolbar.tsx",
        lineNumber: 18,
      },
      memoizedProps: {
        variant: "primary",
      },
      type: {
        displayName: "Toolbar",
      },
    };
    const element: HTMLElement = createElementWithFiber({
      _debugOwner: ownerFiber,
      _debugSource: {
        columnNumber: 9,
        fileName: "webpack:///./src/components/Button.tsx?macro=true",
        lineNumber: 48,
      },
      memoizedProps: {
        disabled: false,
        intent: "primary",
        label: "Save",
        nested: {
          id: 1,
        },
      },
      return: ownerFiber,
      type: {
        defaultProps: {
          intent: "primary",
        },
        name: "Button",
      },
    });

    expect(await inspectComponentElement(element)).toEqual([
      {
        displayName: "Button",
        props: {
          disabled: "false",
          label: "Save",
        },
        source: {
          columnNumber: 9,
          componentName: "Button",
          fileName: "src/components/Button.tsx",
          lineNumber: 48,
        },
      },
      {
        displayName: "Toolbar",
        props: {
          variant: "primary",
        },
        source: {
          columnNumber: 3,
          componentName: "Toolbar",
          fileName: "/Users/test/project/src/Toolbar.tsx",
          lineNumber: 18,
        },
      },
    ]);
  });

  test("falls back to the React DevTools renderer interface when the fiber has no source", async () => {
    const element: HTMLElement = {} as HTMLElement;

    Reflect.set(globalThis, "window", {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        rendererInterfaces: new Map([
          [
            1,
            {
              getDisplayNameForElementID: (): string => "PrimaryButton",
              getElementIDForHostInstance: (): number => 7,
              inspectElement: () => {
                return {
                  type: "full-data",
                  value: {
                    source: ["PrimaryButton", "webpack:///./src/components/PrimaryButton.tsx?macro=true", 54, 11],
                  },
                };
              },
            },
          ],
        ]),
      },
      location: {
        href: "http://localhost:3000/",
        origin: "http://localhost:3000",
      },
    });

    expect(await inspectComponentElement(element)).toEqual([
      {
        displayName: "PrimaryButton",
        props: {},
        source: {
          columnNumber: 11,
          componentName: "PrimaryButton",
          fileName: "src/components/PrimaryButton.tsx",
          lineNumber: 54,
        },
      },
    ]);
  });
});
