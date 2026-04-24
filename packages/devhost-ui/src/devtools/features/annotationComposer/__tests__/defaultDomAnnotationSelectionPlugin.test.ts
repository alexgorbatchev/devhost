import { describe, expect, test } from "bun:test";

import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../../../shared/constants";
import { defaultDomAnnotationSelectionPlugin } from "../defaultDomAnnotationSelectionPlugin";

describe("defaultDomAnnotationSelectionPlugin", () => {
  test("uses the mac default cursor SVG during host-page selection mode", () => {
    const cursorStyleText = defaultDomAnnotationSelectionPlugin.getCursorStyleText?.();

    expect(cursorStyleText).toContain('cursor: url("data:image/svg+xml,');
    expect(cursorStyleText).toContain(
      "%3Csvg%20height%3D%2232%22%20viewBox%3D%220%200%2032%2032%22%20width%3D%2232%22",
    );
    expect(cursorStyleText).toContain(") 10 7, default !important;");
    expect(cursorStyleText).not.toContain("cursor: crosshair !important;");
    expect(cursorStyleText).toContain(`[${DEVTOOLS_ROOT_ATTRIBUTE_NAME}], [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] *`);
  });
});
