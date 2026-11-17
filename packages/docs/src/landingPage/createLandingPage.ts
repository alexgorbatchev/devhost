// The README's silent, looping preview of the promo, with the blank lines around it; GitHub cannot show the player.
const previewPattern = /\n*^<!-- promo-preview -->$[\s\S]*?^<!-- \/promo-preview -->$\n*/gm;

// The landing page is the README's text, with the promo's player where the README shows its preview, or no preview
// when the promo is not published. The player is HTML and the page is MDX, which rejects HTML comments and unclosed
// void elements, so the page imports the file as text and renders it as HTML instead of containing it.
export function createLandingPage(title: string, body: string, promoBlockImportPath: string | undefined): string {
  const previewCount = body.match(previewPattern)?.length ?? 0;
  if (previewCount !== 1) {
    throw new Error(
      `The README must hold one promo-preview block, where the landing page shows the promo; it holds ${previewCount}`,
    );
  }
  const imports: string[] =
    promoBlockImportPath === undefined
      ? []
      : [`import promoDemo from ${JSON.stringify(`${promoBlockImportPath}?raw`)};`];
  const player = promoBlockImportPath === undefined ? "\n\n" : "\n\n<Fragment set:html={promoDemo} />\n\n";

  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${[...imports, body.replace(previewPattern, player).trim()].join("\n\n")}\n`;
}
