import { describe, expect, test } from "bun:test";

import { resolvePopupCoordinates } from "../devtools/features/annotationComposer/resolvePopupCoordinates";

describe("resolvePopupCoordinates", () => {
  test("places the popup to the right of the anchor when there is enough room", () => {
    expect(
      resolvePopupCoordinates({
        anchorBottom: 120,
        anchorLeft: 80,
        anchorTop: 60,
        popupHeight: 180,
        popupWidth: 320,
        viewportHeight: 800,
        viewportPadding: 16,
        viewportWidth: 1200,
      }),
    ).toEqual({
      left: 92,
      top: 60,
    });
  });

  test("clamps the popup inside the viewport when the anchor is near the edges", () => {
    expect(
      resolvePopupCoordinates({
        anchorBottom: 760,
        anchorLeft: 1180,
        anchorTop: 730,
        popupHeight: 220,
        popupWidth: 320,
        viewportHeight: 800,
        viewportPadding: 16,
        viewportWidth: 1200,
      }),
    ).toEqual({
      left: 848,
      top: 564,
    });
  });
});
