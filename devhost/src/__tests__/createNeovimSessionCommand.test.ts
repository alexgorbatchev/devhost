import { describe, expect, test } from "bun:test";

import { createNeovimSessionCommand } from "../createNeovimSessionCommand";

describe("createNeovimSessionCommand", () => {
  test("opens the resolved file path and places the cursor at the requested location", () => {
    expect(
      createNeovimSessionCommand(
        {
          columnNumber: 8,
          fileName: "src/components/PrimaryButton.tsx",
          lineNumber: 42,
        },
        "/tmp/project",
      ),
    ).toEqual([
      "nvim",
      "-c",
      "call cursor(42, 8)",
      "--",
      "/tmp/project/src/components/PrimaryButton.tsx",
    ]);
  });

  test("defaults the cursor column to 1 when the source location omits it", () => {
    expect(
      createNeovimSessionCommand(
        {
          fileName: "webpack:///./src/App.tsx",
          lineNumber: 7,
        },
        "/tmp/project",
      ),
    ).toEqual(["nvim", "-c", "call cursor(7, 1)", "--", "/tmp/project/src/App.tsx"]);
  });
});
