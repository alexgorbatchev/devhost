import { describe, expect, it } from "bun:test";

import { createLandingPage } from "../createLandingPage";

describe("createLandingPage", () => {
  it("opens the page with the promo when there is one", () => {
    const page = createLandingPage("devhost", "\nIntro paragraph.\n\n## Quick start\n", "<video></video>\n");

    expect(page).toBe('---\ntitle: "devhost"\n---\n\n<video></video>\n\nIntro paragraph.\n\n## Quick start\n');
  });

  it("starts with the README text when no promo is published", () => {
    expect(createLandingPage("devhost", "Intro paragraph.\n", undefined)).toBe(
      '---\ntitle: "devhost"\n---\n\nIntro paragraph.\n',
    );
  });
});
