// The landing page is the README's text. When the promo is published, its player opens the page.
export function createLandingPage(title: string, body: string, promoBlock: string | undefined): string {
  const content: string = [promoBlock?.trim(), body.trim()].filter((part) => part !== undefined).join("\n\n");

  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${content}\n`;
}
