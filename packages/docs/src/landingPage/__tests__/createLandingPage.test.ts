import { describe, expect, it } from "bun:test";

import { createLandingPage } from "../createLandingPage";

const readmeBody = [
  "",
  "Intro paragraph.",
  "",
  "<!-- promo-preview -->",
  "[![Silent preview](https://example.com/promo-preview.webp)](./)",
  "",
  "[Watch it with narration](./).",
  "<!-- /promo-preview -->",
  "",
  "## Quick start",
  "",
].join("\n");

describe("createLandingPage", () => {
  it("shows the promo's HTML, imported as raw text, where the README shows its preview", () => {
    const page = createLandingPage("devhost", readmeBody, "../../promoDemo.html");

    expect(page).toBe(
      [
        "---",
        'title: "devhost"',
        "---",
        "",
        'import promoDemo from "../../promoDemo.html?raw";',
        "",
        "Intro paragraph.",
        "",
        "<Fragment set:html={promoDemo} />",
        "",
        "## Quick start",
        "",
      ].join("\n"),
    );
  });

  it("leaves the README's preview out when no promo is published", () => {
    expect(createLandingPage("devhost", readmeBody, undefined)).toBe(
      '---\ntitle: "devhost"\n---\n\nIntro paragraph.\n\n## Quick start\n',
    );
  });

  it.each([
    ["has no preview", "Intro paragraph.\n", 0],
    ["has two previews", `${readmeBody}\n${readmeBody}`, 2],
  ])("rejects a README that %s", (_case, body, count) => {
    expect(() => createLandingPage("devhost", body, "../../promoDemo.html")).toThrow(
      `The README must hold one promo-preview block, where the landing page shows the promo; it holds ${count}`,
    );
  });
});
