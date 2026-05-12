import { describe, expect, test } from "bun:test";

import { defaultDomAnnotationSelectionPlugin } from "../defaultDomAnnotationSelectionPlugin";

describe("defaultDomAnnotationSelectionPlugin", () => {
  test("provides standard cursor styling during host-page selection mode", () => {
    const cursorStyleText = defaultDomAnnotationSelectionPlugin.getCursorStyleText?.();

    expect(cursorStyleText).toMatchInlineSnapshot(`
      "
          body * {
            cursor: default !important;
          }
          a[href],
          button,
          input[type="button"],
          input[type="image"],
          input[type="reset"],
          input[type="submit"],
          label[for],
          select,
          summary,
          [data-devhost-cursor="pointer"],
          [role="button"] {
            cursor: pointer !important;
          }
          [data-devhost-devtools], [data-devhost-devtools] * {
            cursor: default !important;
          }
          [data-devhost-devtools] button,
          [data-devhost-devtools] button *,
          [data-devhost-devtools] [role="button"],
          [data-devhost-devtools] [role="button"] * {
            cursor: pointer !important;
          }
          [data-devhost-devtools] textarea,
          [data-devhost-devtools] input[type="text"] {
            cursor: text !important;
          }
        "
    `);
  });
});
