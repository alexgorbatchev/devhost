import { afterEach, describe, expect, test } from "bun:test";

import { getElementSourceLocation } from "../devtools/features/annotationComposer/getElementSourceLocation";

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

describe("getElementSourceLocation", () => {
  afterEach(() => {
    Reflect.set(globalThis, "window", originalWindow);
  });

  test("prefers the React DevTools renderer interface source when available", () => {
    const element: HTMLElement = {} as HTMLElement;
    let receivedInspectPath: unknown = "not-called";

    Reflect.set(globalThis, "window", {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        rendererInterfaces: new Map([
          [
            1,
            {
              getDisplayNameForElementID: (): string => "PrimaryButton",
              getElementIDForHostInstance: (): number => 7,
              inspectElement: (
                _requestId: number,
                _id: number,
                path: unknown,
              ) => {
                receivedInspectPath = path;

                return {
                  type: "full-data",
                  value: {
                    source: [
                      "PrimaryButton",
                      "webpack:///./src/components/PrimaryButton.tsx?macro=true",
                      54,
                      11,
                    ],
                  },
                };
              },
            },
          ],
        ]),
      },
    });

    expect(getElementSourceLocation(element)).toEqual({
      columnNumber: 11,
      componentName: "PrimaryButton",
      fileName: "src/components/PrimaryButton.tsx",
      lineNumber: 54,
    });
    expect(receivedInspectPath).toBeNull();
  });

  test("falls back to the inspected element stack when the renderer source is absent", () => {
    const element: HTMLElement = {} as HTMLElement;

    Reflect.set(globalThis, "window", {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        rendererInterfaces: new Map([
          [
            1,
            {
              getDisplayNameForElementID: (): string => "Toolbar",
              getElementIDForHostInstance: (): number => 8,
              inspectElement: () => {
                return {
                  type: "full-data",
                  value: {
                    source: null,
                    stack: [["Toolbar", "webpack:///./src/components/Toolbar.tsx", 91, 17, 91, 17, false]],
                  },
                };
              },
            },
          ],
        ]),
      },
    });

    expect(getElementSourceLocation(element)).toEqual({
      columnNumber: 17,
      componentName: "Toolbar",
      fileName: "src/components/Toolbar.tsx",
      lineNumber: 91,
    });
  });

  test("reads direct debug source metadata from the host fiber", () => {
    const element: HTMLElement = createElementWithFiber({
      _debugSource: {
        columnNumber: 9,
        fileName: "webpack:///./src/components/Button.tsx?macro=true#fragment",
        lineNumber: 48,
      },
      type: {
        name: "Button",
      },
    });

    expect(getElementSourceLocation(element)).toEqual({
      columnNumber: 9,
      componentName: "Button",
      fileName: "src/components/Button.tsx",
      lineNumber: 48,
    });
  });

  test("falls back to owner source metadata when the clicked fiber has none", () => {
    const ownerFiber: ReactFiberTestNode = {
      _debugSource: {
        columnNumber: 3,
        fileName: "file:///Users/test/app/src/toolbar/ActionButton.tsx",
        lineNumber: 18,
      },
      type: {
        displayName: "ActionButton",
      },
    };
    const element: HTMLElement = createElementWithFiber({
      _debugOwner: ownerFiber,
      return: ownerFiber,
      type: {
        name: "ForwardRef",
      },
    });

    expect(getElementSourceLocation(element)).toEqual({
      columnNumber: 3,
      componentName: "ActionButton",
      fileName: "/Users/test/app/src/toolbar/ActionButton.tsx",
      lineNumber: 18,
    });
  });

  test("reads babel-style __source metadata from memoized props", () => {
    const element: HTMLElement = createElementWithFiber({
      memoizedProps: {
        __source: {
          columnNumber: 5,
          fileName: "turbopack:///[project]/src/routes/dashboard/page.tsx",
          lineNumber: 72,
        },
      },
      type: {
        name: "DashboardPage",
      },
    });

    expect(getElementSourceLocation(element)).toEqual({
      columnNumber: 5,
      componentName: "DashboardPage",
      fileName: "src/routes/dashboard/page.tsx",
      lineNumber: 72,
    });
  });

  test("returns undefined when the element has no recoverable source metadata", () => {
    const element: HTMLElement = createElementWithFiber({
      type: {
        name: "AnonymousWidget",
      },
    });

    expect(getElementSourceLocation(element)).toBeUndefined();
  });
});
