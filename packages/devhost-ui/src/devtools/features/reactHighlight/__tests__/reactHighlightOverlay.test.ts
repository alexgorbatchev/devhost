import { describe, expect, test } from "bun:test";

import {
  createReactHighlightWebSocketUrl,
  highlightReactElements,
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

interface ITestChildrenCollection {
  item: (index: number) => Element | null;
  length: number;
}

class TestDocument {
  public readonly body: TestElement;
  public readonly createdElements: TestElement[] = [];

  public constructor() {
    this.body = new TestElement(this);
  }

  public createElement(): TestElement {
    const element = new TestElement(this);

    this.createdElements.push(element);

    return element;
  }

  public querySelectorAll(): Element[] {
    return [];
  }
}

class TestElement {
  public children: ITestChildrenCollection;
  public readonly classList: Pick<DOMTokenList, "contains"> = {
    contains: (): boolean => false,
  };
  public readonly ownerDocument: TestDocument;
  public readonly style: Record<string, string> = {};
  private readonly attributes: Map<string, string> = new Map();
  private readonly childElements: TestElement[] = [];
  private readonly rectangle: DOMRect;

  public constructor(ownerDocument: TestDocument, rectangle: Partial<DOMRect> = {}) {
    this.ownerDocument = ownerDocument;
    this.rectangle = {
      bottom: rectangle.bottom ?? 0,
      height: rectangle.height ?? 0,
      left: rectangle.left ?? 0,
      right: rectangle.right ?? 0,
      top: rectangle.top ?? 0,
      width: rectangle.width ?? 0,
      x: rectangle.x ?? rectangle.left ?? 0,
      y: rectangle.y ?? rectangle.top ?? 0,
      toJSON: () => ({}),
    } as DOMRect;
    this.children = this.createChildrenCollection();
  }

  public appendChild(element: TestElement): TestElement {
    this.childElements.push(element);
    this.children = this.createChildrenCollection();

    return element;
  }

  public get appendedChildren(): TestElement[] {
    return this.childElements;
  }

  public getBoundingClientRect(): DOMRect {
    return this.rectangle;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public getAttribute(name: string): string | undefined {
    return this.attributes.get(name);
  }

  private createChildrenCollection(): ITestChildrenCollection {
    return {
      item: (index: number): Element | null => {
        return (this.childElements[index] ?? null) as unknown as Element | null;
      },
      length: this.childElements.length,
    };
  }
}

class TestCustomEvent {
  public readonly detail: unknown;
  public readonly type: string;

  public constructor(type: string, init: CustomEventInit = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

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

  test("mounts React highlight overlays in the devtools overlay root instead of document body", async () => {
    const fallbackDescriptor: PropertyDescriptor = {
      configurable: true,
      value: undefined,
      writable: true,
    };
    const originalDocumentDescriptor: PropertyDescriptor =
      Object.getOwnPropertyDescriptor(globalThis, "document") ?? fallbackDescriptor;
    const originalHTMLElementDescriptor: PropertyDescriptor =
      Object.getOwnPropertyDescriptor(globalThis, "HTMLElement") ?? fallbackDescriptor;
    const originalWindowDescriptor: PropertyDescriptor =
      Object.getOwnPropertyDescriptor(globalThis, "window") ?? fallbackDescriptor;
    const originalCustomEventDescriptor: PropertyDescriptor =
      Object.getOwnPropertyDescriptor(globalThis, "CustomEvent") ?? fallbackDescriptor;
    const documentReplacement = new TestDocument();
    const overlayRoot = new TestElement(documentReplacement);
    const targetElement = new TestElement(documentReplacement, {
      height: 40,
      left: 12,
      top: 24,
      width: 80,
      x: 12,
      y: 24,
    });
    const targetFiber: ReactFiberTestNode = {
      _debugSource: {
        columnNumber: 9,
        fileName: "/Users/test/project/src/Button.tsx",
        lineNumber: 24,
      },
      memoizedProps: {},
      type: {
        name: "Button",
      },
    };
    const dispatchedEvents: TestCustomEvent[] = [];

    Reflect.set(targetElement, "__reactFiber$test", targetFiber);
    documentReplacement.body.appendChild(targetElement);

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: documentReplacement,
      writable: true,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      configurable: true,
      value: TestElement,
      writable: true,
    });
    Object.defineProperty(globalThis, "CustomEvent", {
      configurable: true,
      value: TestCustomEvent,
      writable: true,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        dispatchEvent: (event: TestCustomEvent): boolean => {
          dispatchedEvents.push(event);

          return true;
        },
      },
      writable: true,
    });

    try {
      const overlays = await highlightReactElements(
        "src/Button.tsx:24:9",
        "/Users/test/project",
        overlayRoot as unknown as HTMLElement,
      );

      expect(overlays).toHaveLength(1);
      expect(overlayRoot.appendedChildren).toHaveLength(1);
      expect(documentReplacement.body.appendedChildren).toEqual([targetElement]);
      expect(overlays[0]?.overlay.style.left).toBe("12px");
      expect(overlays[0]?.overlay.style.top).toBe("24px");
      expect(overlays[0]?.overlay.style.width).toBe("80px");
      expect(overlays[0]?.overlay.style.height).toBe("40px");
      expect(dispatchedEvents[0]?.detail).toEqual({
        locator: "src/Button.tsx:24:9",
        matchedCount: 1,
      });
    } finally {
      Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
      Object.defineProperty(globalThis, "HTMLElement", originalHTMLElementDescriptor);
      Object.defineProperty(globalThis, "CustomEvent", originalCustomEventDescriptor);
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    }
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
