import { describe, expect, onTestFinished, test } from "vitest";

import type { IReactFiberNode, IStandardSourceShape } from "../../../shared/reactSourceInspection";
import {
  createReactHighlightWebSocketUrl,
  readReactHighlightLocatorsForElement,
  resolveReactHighlightSourceMapElementLocator,
} from "../reactHighlightOverlay";

/** The development metadata React attaches to a host element, as far as the overlay reads it. */
interface ISourcedFiber extends IReactFiberNode {
  _debugSource: IStandardSourceShape;
}

/** Serves `content` from a URL of its own until the test ends, as a bundler's dev server serves a file. */
function serve(content: string, type: string): string {
  const url: string = URL.createObjectURL(new Blob([content], { type }));

  onTestFinished((): void => URL.revokeObjectURL(url));

  return url;
}

describe("reactHighlightOverlay", () => {
  test("creates a websocket URL without credentials for the current routed page", () => {
    expect(createReactHighlightWebSocketUrl(new URL("https://app.localhost/dashboard"))).toBe(
      "wss://app.localhost/__devhost__/ws/react-highlight",
    );
    expect(createReactHighlightWebSocketUrl(new URL("http://app.localhost:3000/"))).toBe(
      "ws://app.localhost:3000/__devhost__/ws/react-highlight",
    );
  });

  test("reads project-relative owner-chain locators from a React host element", () => {
    const targetElement: HTMLButtonElement = document.createElement("button");
    const ownerFiber: ISourcedFiber = {
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
    const targetFiber: ISourcedFiber = {
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

    document.body.append(targetElement);
    Reflect.set(targetElement, "__reactFiber$test", targetFiber);

    expect(readReactHighlightLocatorsForElement(targetElement, "/Users/test/project")).toEqual([
      "src/Button.tsx:24:9",
      "src/App.tsx:10:5",
    ]);
  });

  test("resolves host JSX elements from Bun source maps when React fibers have no source metadata", async () => {
    const sourceMapUrl: string = serve(
      JSON.stringify({
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
      }),
      "application/json",
    );
    // The page's own bundle: a script the browser loads and runs, ending in the comment that names its source map.
    const script: HTMLScriptElement = document.createElement("script");
    const scriptLoaded = Promise.withResolvers<void>();

    script.addEventListener("load", (): void => scriptLoaded.resolve());
    script.src = serve(`void 0;\n//# sourceMappingURL=${sourceMapUrl}`, "text/javascript");
    document.body.append(script);
    await scriptLoaded.promise;

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
  });
});
