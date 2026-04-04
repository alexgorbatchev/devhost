import { afterEach, describe, expect, test } from "bun:test";

import { getElementSourceLocation } from "../getElementSourceLocation";
import type { TestFetchInput } from "../../../../utils/__tests__/testTypes";

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

const originalFetch: typeof fetch = globalThis.fetch;
const originalWindow: unknown = Reflect.get(globalThis, "window");

function createElementWithFiber(fiber: ReactFiberTestNode): HTMLElement {
  const element: HTMLElement = {} as HTMLElement;

  Reflect.set(element, "__reactFiber$test", fiber);

  return element;
}

describe("getElementSourceLocation", () => {
  afterEach(() => {
    Reflect.set(globalThis, "window", originalWindow);
    Reflect.set(globalThis, "fetch", originalFetch);
  });

  test("symbolicates generated bundle locations through source maps", async () => {
    const element: HTMLElement = createElementWithFiber({
      _debugSource: {
        columnNumber: 6,
        fileName: "http://localhost:3000/_bun/client/index.js",
        lineNumber: 1,
      },
      type: {
        name: "App",
      },
    });

    Reflect.set(globalThis, "window", {
      location: {
        href: "http://localhost:3000/",
        origin: "http://localhost:3000",
      },
    });
    const responseByUrl: Map<string, Response> = new Map<string, Response>([
      [
        "http://localhost:3000/_bun/client/index.js",
        new Response('console.log("app");\n//# sourceMappingURL=index.js.map'),
      ],
      [
        "http://localhost:3000/_bun/client/index.js.map",
        new Response(
          JSON.stringify({
            file: "index.js",
            mappings: "KAyCIA",
            names: ["App"],
            sources: ["file:///Users/test/app/App.tsx"],
            version: 3,
          }),
        ),
      ],
    ]);

    Reflect.set(globalThis, "fetch", async (input: TestFetchInput): Promise<Response> => {
      const requestUrl: string = String(input);

      return responseByUrl.get(requestUrl) ?? new Response(null, { status: 404 });
    });

    expect(await getElementSourceLocation(element)).toEqual({
      columnNumber: 5,
      componentName: "App",
      fileName: "/Users/test/app/App.tsx",
      lineNumber: 42,
    });
  });

  test("prefers the React DevTools renderer interface source when available", async () => {
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
              inspectElement: (_requestId: number, _id: number, path: unknown) => {
                receivedInspectPath = path;

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

    expect(await getElementSourceLocation(element)).toEqual({
      columnNumber: 11,
      componentName: "PrimaryButton",
      fileName: "src/components/PrimaryButton.tsx",
      lineNumber: 54,
    });
    expect(receivedInspectPath).toBeNull();
  });

  test("falls back to the inspected element stack when the renderer source is absent", async () => {
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
      location: {
        href: "http://localhost:3000/",
        origin: "http://localhost:3000",
      },
    });

    expect(await getElementSourceLocation(element)).toEqual({
      columnNumber: 17,
      componentName: "Toolbar",
      fileName: "src/components/Toolbar.tsx",
      lineNumber: 91,
    });
  });

  test("reads direct debug source metadata from the host fiber", async () => {
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

    expect(await getElementSourceLocation(element)).toEqual({
      columnNumber: 9,
      componentName: "Button",
      fileName: "src/components/Button.tsx",
      lineNumber: 48,
    });
  });

  test("falls back to owner source metadata when the clicked fiber has none", async () => {
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

    expect(await getElementSourceLocation(element)).toEqual({
      columnNumber: 3,
      componentName: "ActionButton",
      fileName: "/Users/test/app/src/toolbar/ActionButton.tsx",
      lineNumber: 18,
    });
  });

  test("reads babel-style __source metadata from memoized props", async () => {
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

    expect(await getElementSourceLocation(element)).toEqual({
      columnNumber: 5,
      componentName: "DashboardPage",
      fileName: "src/routes/dashboard/page.tsx",
      lineNumber: 72,
    });
  });

  test("returns undefined when the element has no recoverable source metadata", async () => {
    const element: HTMLElement = createElementWithFiber({
      type: {
        name: "AnonymousWidget",
      },
    });

    expect(await getElementSourceLocation(element)).toBeUndefined();
  });
});
