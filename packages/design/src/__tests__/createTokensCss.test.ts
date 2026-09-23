import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { DESIGN_TOKENS } from "../constants";
import { createTokensCss } from "../createTokensCss";
import { fixture_designTokens } from "./fixtures";

const designPackagePath = join(import.meta.dir, "..", "..");

describe("createTokensCss", () => {
  it("emits dark defaults for documents, shadow hosts, and backdrops, then light overrides for data-theme", () => {
    const css = createTokensCss(fixture_designTokens);

    expect(css).toContain(":root");
    expect(css).toContain(":host");
    expect(css).toContain("::backdrop");
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain(':host([data-theme="light"])');

    expect(css).toContain("--dh-radius-sm: radiusSm;");
    expect(css).toContain("--dh-mark: mark;");
    expect(css).toContain("--dh-surface: dark-surface;");
    expect(css).toContain("--dh-surface: light-surface;");
  });

  it("matches the committed tokens.css (regenerate with `bun run --cwd packages/design write-tokens`)", () => {
    expect(readFileSync(join(designPackagePath, "tokens.css"), "utf8")).toBe(createTokensCss(DESIGN_TOKENS));
  });
});
