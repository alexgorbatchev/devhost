import { describe, expect, test } from "bun:test";

import { createComponentSourceUrl, formatComponentSourcePath } from "../componentSourceUtils";

describe("componentSourceUtils", () => {
  test("formats source paths relative to the injected project root", () => {
    expect(
      formatComponentSourcePath(
        {
          columnNumber: 9,
          fileName: "/Users/test/project/src/components/Button.tsx",
          lineNumber: 48,
        },
        "/Users/test/project",
      ),
    ).toBe("src/components/Button.tsx:48:9");
  });

  test("builds a VS Code URL from a relative source path", () => {
    expect(
      createComponentSourceUrl(
        {
          columnNumber: 11,
          fileName: "src/components/Button.tsx",
          lineNumber: 54,
        },
        "vscode",
        "/Users/test/project",
      ),
    ).toBe("vscode://file//Users/test/project/src/components/Button.tsx:54:11");
  });

  test("builds a Cursor URL from an absolute source path", () => {
    expect(
      createComponentSourceUrl(
        {
          columnNumber: 5,
          fileName: "/Users/test/project/src/App.tsx",
          lineNumber: 42,
        },
        "cursor",
        "/Users/test/project",
      ),
    ).toBe("cursor://open?url=file%3A%2F%2F%2FUsers%2Ftest%2Fproject%2Fsrc%2FApp.tsx&line=42&column=5");
  });

  test("builds a WebStorm URL from a cleaned webpack path", () => {
    expect(
      createComponentSourceUrl(
        {
          fileName: "webpack:///./src/routes/page.tsx?macro=true",
          lineNumber: 12,
        },
        "webstorm",
        "/Users/test/project",
      ),
    ).toBe("webstorm://open?file=%2FUsers%2Ftest%2Fproject%2Fsrc%2Froutes%2Fpage.tsx&line=12");
  });
});
