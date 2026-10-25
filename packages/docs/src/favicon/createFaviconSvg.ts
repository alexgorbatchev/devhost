import type { IDesignTokens } from "@alexgorbatchev/devhost-design";

// The site title's 20-pixel `dh` mark, drawn on a 32-pixel canvas.
const markSize = 20;
const canvasSize = 32;

// Draws the site title's `dh` mark as an SVG favicon that follows the browser's light or dark preference.
export function createFaviconSvg(tokens: IDesignTokens): string {
  const { light, dark } = tokens.schemes;
  const radius = (Number.parseFloat(tokens.shape.radiusSm) * canvasSize) / markSize;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}">`,
    `<style>rect{fill:${light.fg}}text{fill:${light.surface}}`,
    `@media (prefers-color-scheme: dark){rect{fill:${dark.fg}}text{fill:${dark.surface}}}</style>`,
    `<rect width="${canvasSize}" height="${canvasSize}" rx="${radius}"/>`,
    `<text x="16" y="21.5" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="16" font-weight="700" letter-spacing="-0.64">dh</text>`,
    "</svg>",
    "",
  ].join("\n");
}
