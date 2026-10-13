import { describe, expect, it } from "bun:test";

import { createLandingPage } from "../createLandingPage";

describe("createLandingPage", () => {
  it("opens the page with the promo's HTML, imported as raw text, when there is one", () => {
    const page = createLandingPage("devhost", "\nIntro paragraph.\n\n## Quick start\n", "../../promoDemo.html");

    expect(page).toBe(
      [
        "---",
        'title: "devhost"',
        "---",
        "",
        'import promoDemo from "../../promoDemo.html?raw";',
        "",
        "<Fragment set:html={promoDemo} />",
        "",
        "Intro paragraph.",
        "",
        "## Quick start",
        "",
      ].join("\n"),
    );
  });

  it("starts with the README text when no promo is published", () => {
    expect(createLandingPage("devhost", "Intro paragraph.\n", undefined)).toBe(
      '---\ntitle: "devhost"\n---\n\nIntro paragraph.\n',
    );
  });
});
