import { describe, expect, test } from "bun:test";

import {
  createReactHighlightWebSocketUrl,
  readReactHighlightLocatorsForElement,
  resolveReactHighlightSourceMapElementLocator,
} from "../reactHighlightOverlay";

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

type FetchInput = Parameters<typeof fetch>[0];

type ScriptElementReplacement = Element & {
  src: string;
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

  test("resolves host JSX elements from Bun source maps when React fibers have no source metadata", async () => {
    const fallbackDocumentDescriptor: PropertyDescriptor = {
      configurable: true,
      value: undefined,
      writable: true,
    };
    const originalDocumentDescriptor: PropertyDescriptor =
      Object.getOwnPropertyDescriptor(globalThis, "document") ?? fallbackDocumentDescriptor;
    const originalFetch: typeof fetch = globalThis.fetch;
    const scriptElement = {
      src: "http://127.0.0.1:4000/_bun/client/index.js",
    } as ScriptElementReplacement;
    const documentReplacement = {
      querySelectorAll(selector: string): Element[] {
        expect(selector).toBe("script[src]");

        return [scriptElement];
      },
    };
    const sourceMapPayload = {
      sources: ["file:///Users/test/project/src/App.tsx"],
      sourcesContent: [
        [
          "export function App() {",
          "  return (",
          '    <div className="app">',
          "      <h1>Bun + React</h1>",
          "      <p>",
          "        Edit <code>src/App.tsx</code>",
          "      </p>",
          "    </div>",
          "  );",
          "}",
        ].join("\n"),
      ],
    };

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentReplacement,
      writable: true,
    });
    const fetchReplacement = async (input: FetchInput): Promise<Response> => {
      const url: string = input.toString();
      const responses: Map<string, Response> = new Map([
        [
          "http://127.0.0.1:4000/_bun/client/index.js",
          new Response('console.log("app");\n//# sourceMappingURL=/index.js.map'),
        ],
        ["http://127.0.0.1:4000/index.js.map", Response.json(sourceMapPayload)],
      ]);

      return responses.get(url) ?? new Response(null, { status: 404 });
    };
    globalThis.fetch = Object.assign(fetchReplacement, {
      preconnect: originalFetch.preconnect,
    });

    try {
      await expect(
        resolveReactHighlightSourceMapElementLocator("src/App.tsx:4:7", "/Users/test/project"),
      ).resolves.toEqual({
        classNames: [],
        occurrenceIndex: 0,
        tagName: "h1",
      });
      await expect(
        resolveReactHighlightSourceMapElementLocator("src/App.tsx:3:5", "/Users/test/project"),
      ).resolves.toEqual({
        classNames: ["app"],
        occurrenceIndex: 0,
        tagName: "div",
      });
      await expect(
        resolveReactHighlightSourceMapElementLocator("src/App.tsx:6:14", "/Users/test/project"),
      ).resolves.toEqual({
        classNames: [],
        occurrenceIndex: 0,
        tagName: "code",
      });
    } finally {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
      globalThis.fetch = originalFetch;
    }
  });
});
