import { expect, it } from "bun:test";
import { DESIGN_TOKENS, type IDesignTokens } from "@alexgorbatchev/devhost-design";
import { createFaviconSvg } from "../createFaviconSvg";

const tokens: IDesignTokens = {
  ...DESIGN_TOKENS,
  schemes: {
    light: { ...DESIGN_TOKENS.schemes.light, fg: "#000001", surface: "#000002" },
    dark: { ...DESIGN_TOKENS.schemes.dark, fg: "#000003", surface: "#000004" },
  },
  shape: { ...DESIGN_TOKENS.shape, radiusSm: "5px" },
};

it("draws the mark in each scheme's foreground with the letters in its surface color", () => {
  const svg = createFaviconSvg(tokens);
  const [lightRules, darkRules] = svg.split("@media (prefers-color-scheme: dark)");

  expect(lightRules).toContain("rect{fill:#000001}text{fill:#000002}");
  expect(darkRules).toContain("rect{fill:#000003}text{fill:#000004}");
});

it("scales the mark's corner radius to the favicon canvas", () => {
  expect(createFaviconSvg(tokens)).toContain('rx="8"');
});
