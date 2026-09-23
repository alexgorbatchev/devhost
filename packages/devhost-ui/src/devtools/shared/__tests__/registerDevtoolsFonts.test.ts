import { describe, expect, test } from "bun:test";
import latinFontUrl from "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2";

import { DEVTOOLS_FONT_FAMILY } from "../constants";
import { registerDevtoolsFonts } from "../registerDevtoolsFonts";

interface IRecordedFontFace {
  descriptors: FontFaceDescriptors;
  family: string;
  source: string;
}

function createRecordingFontFaceSet(): { addedFontFaces: FontFace[]; fontFaceSet: Pick<FontFaceSet, "add"> } {
  const addedFontFaces: FontFace[] = [];
  const fontFaceSet: Pick<FontFaceSet, "add"> = {
    add: (fontFace: FontFace): FontFaceSet => {
      addedFontFaces.push(fontFace);
      return fontFaceSet as FontFaceSet;
    },
  };

  return { addedFontFaces, fontFaceSet };
}

function createRecordingFontFaceFactory(): {
  createFontFace: (family: string, source: string, descriptors: FontFaceDescriptors) => FontFace;
  recordedFontFaces: IRecordedFontFace[];
} {
  const recordedFontFaces: IRecordedFontFace[] = [];

  return {
    createFontFace: (family: string, source: string, descriptors: FontFaceDescriptors): FontFace => {
      const recordedFontFace: IRecordedFontFace = { descriptors, family, source };

      recordedFontFaces.push(recordedFontFace);
      return recordedFontFace as unknown as FontFace;
    },
    recordedFontFaces,
  };
}

describe("registerDevtoolsFonts", () => {
  test("registers every bundled subset under the namespaced devtools family", () => {
    const { addedFontFaces, fontFaceSet } = createRecordingFontFaceSet();
    const { createFontFace, recordedFontFaces } = createRecordingFontFaceFactory();

    registerDevtoolsFonts(fontFaceSet, createFontFace);

    expect(addedFontFaces.length).toBe(6);
    expect(recordedFontFaces.map((fontFace: IRecordedFontFace) => fontFace.family)).toEqual(
      Array.from({ length: 6 }, () => DEVTOOLS_FONT_FAMILY),
    );
    expect(
      new Set(recordedFontFaces.map((fontFace: IRecordedFontFace) => fontFace.descriptors.unicodeRange)).size,
    ).toBe(6);
    expect(recordedFontFaces.find((fontFace: IRecordedFontFace) => fontFace.source.includes(latinFontUrl))).toEqual({
      descriptors: {
        display: "swap",
        style: "normal",
        unicodeRange:
          "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
        weight: "100 800",
      },
      family: DEVTOOLS_FONT_FAMILY,
      source: `url("${latinFontUrl}") format("woff2")`,
    });
  });

  test("registers fonts only once per font face set", () => {
    const { addedFontFaces, fontFaceSet } = createRecordingFontFaceSet();
    const { createFontFace } = createRecordingFontFaceFactory();

    registerDevtoolsFonts(fontFaceSet, createFontFace);
    registerDevtoolsFonts(fontFaceSet, createFontFace);

    expect(addedFontFaces.length).toBe(6);
  });

  test("registers fonts separately for each font face set", () => {
    const firstTarget = createRecordingFontFaceSet();
    const secondTarget = createRecordingFontFaceSet();
    const { createFontFace } = createRecordingFontFaceFactory();

    registerDevtoolsFonts(firstTarget.fontFaceSet, createFontFace);
    registerDevtoolsFonts(secondTarget.fontFaceSet, createFontFace);

    expect(firstTarget.addedFontFaces.length).toBe(6);
    expect(secondTarget.addedFontFaces.length).toBe(6);
  });
});
