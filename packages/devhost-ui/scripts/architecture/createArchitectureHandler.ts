export function createArchitectureHandler(directory: string) {
  const pages = new Bun.Glob("**/*.html");

  return async (request: Request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const pathname = new URL(request.url).pathname;
    const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" };
    if (pathname === "/" || pathname === "/index.md") {
      const source = await Bun.file(`${directory}/index.md`).text();
      const frontmatter = /^\uFEFF?---[\t ]*\r?\n([\s\S]*?)\r?\n---[\t ]*(?:\r?\n|$)/.exec(source);
      const markdown = frontmatter === null ? source : source.slice(frontmatter[0].length);
      let metadata = "";
      if (frontmatter !== null) {
        const attributes: unknown = Bun.YAML.parse(frontmatter[1] ?? "");
        if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) {
          throw new Error("Architecture index frontmatter must be a YAML mapping");
        }
        const items = Object.entries(attributes).map(([key, value]) => {
          const text = typeof value === "string" ? value : JSON.stringify(value);
          return `<li><strong>${Bun.escapeHTML(key)}</strong>: ${Bun.escapeHTML(text ?? "")}</li>`;
        });
        metadata = `<ul class="frontmatter" aria-label="Document metadata">${items.join("")}</ul>`;
      }
      const content = Bun.markdown.html(markdown);
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>devhost architecture</title><style>body{font-family:system-ui;max-width:80rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color-scheme:light dark}.frontmatter{font-size:.8rem;line-height:1.35;padding-inline-start:1.25rem}th,td{text-align:left;padding:.35rem .8rem}table{border-collapse:collapse}tr{border-bottom:1px solid #888}</style></head><body>${metadata}${content}</body></html>`,
        { headers },
      );
    }

    for await (const path of pages.scan(directory)) {
      if (pathname === `/${path}`) return new Response(Bun.file(`${directory}/${path}`), { headers });
    }
    return new Response("Not found", { status: 404 });
  };
}
