import type { ViewportSize } from "playwright";

export const viewport: ViewportSize = { width: 1280, height: 720 };
export const captionBandHeight: number = 140;
// The promo zooms into the devtools, so its scenes are captured with two device pixels per CSS pixel.
export const promoCaptureScale: number = 2;
// A guide film shows its recording in a window, so its scenes are captured at twice the size to stay sharp.
export const guideCaptureScale: number = 2;
export const promoMaximumSeconds: number = 45;
// A guide film opens on a title card and closes on an end card, with the recorded clips between them.
export const guideIntroSeconds: number = 2.4;
export const guideOutroSeconds: number = 1.8;
// The HyperFrames release pinned in promo/package.json declares this as its oldest supported Node.js.
export const promoMinimumNodeMajor: number = 22;
