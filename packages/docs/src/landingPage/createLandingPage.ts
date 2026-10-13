// The landing page is the README's text. When the promo is published, its player opens the page. The player is HTML
// and the page is MDX, which rejects HTML comments and unclosed void elements, so the page imports the file as text
// and renders it as HTML instead of containing it.
export function createLandingPage(title: string, body: string, promoBlockImportPath: string | undefined): string {
  const promo: string[] =
    promoBlockImportPath === undefined
      ? []
      : [
          `import promoDemo from ${JSON.stringify(`${promoBlockImportPath}?raw`)};`,
          "<Fragment set:html={promoDemo} />",
        ];

  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${[...promo, body.trim()].join("\n\n")}\n`;
}
