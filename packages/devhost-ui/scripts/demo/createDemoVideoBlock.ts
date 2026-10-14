import type { IDemoVideoBlock } from "./types";

// The player a docs page shows for a film, between comments that mark it for replacement.
export function createDemoVideoBlock(block: IDemoVideoBlock): string {
  const url = `https://alexgorbatchev.github.io/devhost/demos/${block.name}`;
  return [
    `<!-- ${block.marker} -->`,
    `<video controls playsinline preload="none" width="${block.media.width}" height="${block.media.height}" style="width:100%;height:auto" poster="${url}.webp" aria-label="${Bun.escapeHTML(block.label)}">`,
    `  <source src="${url}.mp4" type="video/mp4">`,
    `  <track kind="captions" src="${url}.vtt" srclang="en" label="English">`,
    `  <a href="${url}.mp4">Watch the demo video</a>.`,
    "</video>",
    `<!-- /${block.marker} -->`,
  ].join("\n");
}
