import { describe, expect, test } from "bun:test";

import { createReactHighlightWebSocketUrl, readReactHighlightLocatorsForElement } from "../reactHighlightOverlay";

type ReactFiberTestNode = {
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
  };
};

describe("reactHighlightOverlay", () => {
  test("creates an instance-token websocket URL for the current routed page", () => {
    const location: Location = new URL("https://app.localhost/dashboard") as unknown as Location;

    expect(createReactHighlightWebSocketUrl(location, "instance-token")).toBe(
      "wss://app.localhost/__devhost__/ws/react-highlight?token=instance-token",
    );
  });

  test("reads project-relative owner-chain locators from a React host element", () => {
    const targetElement: HTMLElement = {} as HTMLElement;
    const ownerFiber: ReactFiberTestNode = {
      _debugSource: {
        columnNumber: 5,
        fileName: "/Users/test/project/src/App.tsx",
        lineNumber: 10,
      },
      memoizedProps: {},
      type: {
        name: "App",
      },
    };
    const targetFiber: ReactFiberTestNode = {
      _debugSource: {
        columnNumber: 9,
        fileName: "/Users/test/project/src/Button.tsx",
        lineNumber: 24,
      },
      memoizedProps: {},
      return: ownerFiber,
      type: {
        name: "Button",
      },
    };

    Reflect.set(targetElement, "__reactFiber$test", targetFiber);

    expect(readReactHighlightLocatorsForElement(targetElement, "/Users/test/project")).toEqual([
      "src/Button.tsx:24:9",
      "src/App.tsx:10:5",
    ]);
  });
});
