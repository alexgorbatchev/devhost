import { assert, describe, expect, test } from "vitest";

import { DEVTOOLS_FONT_FAMILY } from "../constants";
import { registerDevtoolsFonts } from "../registerDevtoolsFonts";

// The Latin subset's range as the font package declares it.
const latinUnicodeRange: string =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

// A font face reports its family and its range in the browser's own notation, so both are read back from one.
function readDevtoolsFontFaces(fontFaceSet: FontFaceSet): FontFace[] {
  const devtoolsFamily: string = new FontFace(DEVTOOLS_FONT_FAMILY, "url(about:blank)").family;

  return Array.from(fontFaceSet).filter((fontFace: FontFace): boolean => fontFace.family === devtoolsFamily);
}

/** A second document, with a font set and a `FontFace` of its own. */
function addFrame(): Window {
  const frame: HTMLIFrameElement = document.createElement("iframe");

  document.body.append(frame);

  const frameWindow: Window | null = frame.contentWindow;

  assert(frameWindow !== null);

  return frameWindow;
}

function isFontFaceConstructor(value: unknown): value is typeof FontFace {
  return typeof value === "function";
}

describe("registerDevtoolsFonts", () => {
  test("registers every bundled subset under the namespaced devtools family, once per font set", async () => {
    expect(readDevtoolsFontFaces(document.fonts)).toEqual([]);

    registerDevtoolsFonts(document.fonts);

    const fontFaces: FontFace[] = readDevtoolsFontFaces(document.fonts);
    const normalizedLatinRange: string = new FontFace("range", "url(about:blank)", {
      unicodeRange: latinUnicodeRange,
    }).unicodeRange;
    const latinFontFace: FontFace | undefined = fontFaces.find((fontFace: FontFace): boolean => {
      return fontFace.unicodeRange === normalizedLatinRange;
    });

    expect(fontFaces).toHaveLength(6);
    expect(new Set(fontFaces.map((fontFace: FontFace): string => fontFace.unicodeRange)).size).toBe(6);
    expect(fontFaces.map((fontFace: FontFace) => [fontFace.display, fontFace.style, fontFace.weight])).toEqual(
      Array.from({ length: 6 }, () => ["swap", "normal", "100 800"]),
    );
    expect(latinFontFace?.status).toBe("unloaded");

    // Each subset names a font file the browser can fetch and decode.
    await Promise.all(fontFaces.map((fontFace: FontFace): Promise<FontFace> => fontFace.load()));
    expect(fontFaces.map((fontFace: FontFace): FontFaceLoadStatus => fontFace.status)).toEqual(
      Array.from({ length: 6 }, (): FontFaceLoadStatus => "loaded"),
    );

    registerDevtoolsFonts(document.fonts);
    expect(readDevtoolsFontFaces(document.fonts)).toHaveLength(6);
  });

  test("registers fonts separately for each font face set", () => {
    const frameWindow: Window = addFrame();
    const frameFonts: FontFaceSet = frameWindow.document.fonts;
    const FrameFontFace: unknown = Reflect.get(frameWindow, "FontFace");

    assert(isFontFaceConstructor(FrameFontFace));

    registerDevtoolsFonts(document.fonts);
    registerDevtoolsFonts(frameFonts, (family: string, source: string, descriptors: FontFaceDescriptors): FontFace => {
      return new FrameFontFace(family, source, descriptors);
    });
    registerDevtoolsFonts(frameFonts);

    expect(readDevtoolsFontFaces(frameFonts)).toHaveLength(6);
    expect(readDevtoolsFontFaces(document.fonts)).toHaveLength(6);
  });
});
