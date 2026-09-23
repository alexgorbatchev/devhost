import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { DESIGN_TOKENS } from "../constants";
import { createTokensCss } from "../createTokensCss";
import { fixture_designTokens } from "./fixtures";

const designPackagePath = join(import.meta.dir, "..", "..");

describe("createTokensCss", () => {
  it("emits dark defaults for documents, shadow hosts, and backdrops, then light overrides for data-theme", () => {
    expect(createTokensCss(fixture_designTokens)).toMatchInlineSnapshot(`
      "/* Generated from packages/design/src/constants.ts by \`bun run --cwd packages/design write-tokens\`. Do not edit. */

      :root,
      :host,
      ::backdrop {
        --dh-radius-sm: radiusSm;
        --dh-radius-md: radiusMd;
        --dh-mark: mark;
        --dh-mark-ink: markInk;
        --dh-mark-alt: markAlt;
        --dh-mark-halo-in: markHaloIn;
        --dh-mark-halo-out: markHaloOut;
        --dh-surface: dark-surface;
        --dh-surface-2: dark-surface2;
        --dh-surface-3: dark-surface3;
        --dh-fg: dark-fg;
        --dh-fg-muted: dark-fgMuted;
        --dh-fg-faint: dark-fgFaint;
        --dh-line: dark-line;
        --dh-edge: dark-edge;
        --dh-halo: dark-halo;
        --dh-shadow: dark-shadow;
        --dh-accent: dark-accent;
        --dh-on-accent: dark-onAccent;
        --dh-ok: dark-ok;
        --dh-on-ok: dark-onOk;
        --dh-warn: dark-warn;
        --dh-on-warn: dark-onWarn;
        --dh-danger: dark-danger;
        --dh-on-danger: dark-onDanger;
        --dh-danger-soft: dark-dangerSoft;
        --dh-backdrop: dark-backdrop;
        --dh-term-bg: dark-termBg;
      }

      [data-theme="light"],
      [data-theme="light"] ::backdrop,
      :host([data-theme="light"]) {
        --dh-surface: light-surface;
        --dh-surface-2: light-surface2;
        --dh-surface-3: light-surface3;
        --dh-fg: light-fg;
        --dh-fg-muted: light-fgMuted;
        --dh-fg-faint: light-fgFaint;
        --dh-line: light-line;
        --dh-edge: light-edge;
        --dh-halo: light-halo;
        --dh-shadow: light-shadow;
        --dh-accent: light-accent;
        --dh-on-accent: light-onAccent;
        --dh-ok: light-ok;
        --dh-on-ok: light-onOk;
        --dh-warn: light-warn;
        --dh-on-warn: light-onWarn;
        --dh-danger: light-danger;
        --dh-on-danger: light-onDanger;
        --dh-danger-soft: light-dangerSoft;
        --dh-backdrop: light-backdrop;
        --dh-term-bg: light-termBg;
      }
      "
    `);
  });

  it("matches the committed tokens.css (regenerate with `bun run --cwd packages/design write-tokens`)", () => {
    expect(readFileSync(join(designPackagePath, "tokens.css"), "utf8")).toBe(createTokensCss(DESIGN_TOKENS));
  });
});
