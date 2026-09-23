import { describe, expect, test } from "bun:test";

import { createShadowRootPropertyFallbackCssText } from "../createShadowRootPropertyFallbackCssText";

describe("createShadowRootPropertyFallbackCssText", () => {
  test("declares non-inherited property defaults on every element in the properties layer", () => {
    expect(
      createShadowRootPropertyFallbackCssText([
        { inherits: false, initialValue: "solid", name: "--tw-border-style" },
        { inherits: false, initialValue: "0 0 #0000", name: "--tw-shadow" },
      ]),
    ).toBe(
      "@layer properties { *, ::before, ::after, ::backdrop { --tw-border-style: solid; --tw-shadow: 0 0 #0000; } }",
    );
  });

  test("declares inherited property defaults once on the shadow host", () => {
    expect(
      createShadowRootPropertyFallbackCssText([
        { inherits: true, initialValue: "1", name: "--tw-inherited" },
        { inherits: false, initialValue: "0", name: "--tw-translate-x" },
      ]),
    ).toBe(
      "@layer properties { *, ::before, ::after, ::backdrop { --tw-translate-x: 0; } :host { --tw-inherited: 1; } }",
    );
  });

  test("skips properties without an initial value", () => {
    expect(
      createShadowRootPropertyFallbackCssText([
        { inherits: false, initialValue: null, name: "--tw-animation-duration" },
        { inherits: false, initialValue: "solid", name: "--tw-border-style" },
      ]),
    ).toBe("@layer properties { *, ::before, ::after, ::backdrop { --tw-border-style: solid; } }");
  });

  test("returns an empty string when nothing needs a fallback", () => {
    expect(
      createShadowRootPropertyFallbackCssText([
        { inherits: false, initialValue: null, name: "--tw-animation-duration" },
      ]),
    ).toBe("");
  });
});
