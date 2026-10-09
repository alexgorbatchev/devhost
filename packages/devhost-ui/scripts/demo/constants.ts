import type { ViewportSize } from "playwright";

export const viewport: ViewportSize = { width: 1280, height: 720 };
export const captionBandHeight: number = 140;
// The promo zooms into the devtools, so its scenes are captured with two device pixels per CSS pixel.
export const promoCaptureScale: number = 2;
export const promoMaximumSeconds: number = 45;
