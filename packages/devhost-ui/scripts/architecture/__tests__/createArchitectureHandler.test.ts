import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createArchitectureHandler } from "../createArchitectureHandler";

test("serves the real index and each linked diagram over HTTP, including HEAD", async () => {
  const directory = `${import.meta.dir}/../../../../../docs/internal/architecture`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createArchitectureHandler(directory) });
  try {
    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    const paths: string[] = [];
    let headings = 0;
    await new HTMLRewriter()
      .on("h1", {
        element: () => {
          headings += 1;
        },
      })
      .on('a[href$=".html"]', {
        element: (element) => {
          paths.push(element.getAttribute("href") ?? "");
        },
      })
      .transform(response)
      .text();
    expect(headings).toBe(1);
    expect(paths).toEqual(["overview.html"]);
    for (const path of paths) {
      const diagram = await fetch(new URL(path, server.url));
      expect(diagram.status).toBe(200);
      expect(await diagram.text()).toBe(await Bun.file(`${directory}/${path}`).text());
      const head = await fetch(new URL(path, server.url), { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
    }
    const markdownAlias = await fetch(new URL("index.md", server.url));
    const index = await fetch(server.url);
    expect(await markdownAlias.text()).toBe(await index.text());
    const head = await fetch(server.url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const write = await fetch(server.url, { method: "POST" });
    expect(write.status).toBe(405);
    expect(write.headers.get("Allow")).toBe("GET, HEAD");
    expect(await write.text()).toBe("Method not allowed");
    for (const path of [
      "overview.json",
      "overview.delivery.json",
      "justfile",
      "missing.html",
      "../AGENTS.md",
      "%2e%2e%2fAGENTS.md",
    ]) {
      const missing = await fetch(new URL(path, server.url));
      expect(missing.status).toBe(404);
      expect(await missing.text()).toBe("Not found");
    }
  } finally {
    await server.stop(true);
  }
});

test.each([
  { lineEnding: "\n", prefix: "" },
  { lineEnding: "\r\n", prefix: "\uFEFF" },
])("renders YAML metadata as a bullet list with $lineEnding line endings", async ({ lineEnding, prefix }) => {
  await mkdir(`${tmpdir()}/devhost-e2e`, { recursive: true });
  const directory = await mkdtemp(`${tmpdir()}/devhost-e2e/architecture-frontmatter-`);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createArchitectureHandler(directory) });
  try {
    await Bun.write(
      `${directory}/index.md`,
      prefix +
        [
          "--- ",
          'title: "<em>Architecture & routing</em>"',
          "summary: >-",
          "  First line",
          "  second line",
          "status: current",
          "--- ",
          "# Overview",
          "",
          "---",
          "",
          "Body content.",
        ].join(lineEnding),
    );
    const items: string[] = [];
    let separators = 0;
    let embeddedMarkup = 0;
    await new HTMLRewriter()
      .on('ul[aria-label="Document metadata"] li', {
        element: () => {
          items.push("");
        },
        text: (chunk) => {
          items[items.length - 1] += chunk.text;
        },
      })
      .on('ul[aria-label="Document metadata"] em', {
        element: () => {
          embeddedMarkup += 1;
        },
      })
      .on("hr", {
        element: () => {
          separators += 1;
        },
      })
      .transform(await fetch(server.url))
      .text();
    expect(items).toEqual([
      "title: &lt;em&gt;Architecture &amp; routing&lt;/em&gt;",
      "summary: First line second line",
      "status: current",
    ]);
    expect(embeddedMarkup).toBe(0);
    expect(separators).toBe(1);
    await Bun.write(`${directory}/index.md`, "# No metadata\n");
    let metadataLists = 0;
    await new HTMLRewriter()
      .on('ul[aria-label="Document metadata"]', {
        element: () => {
          metadataLists += 1;
        },
      })
      .transform(await fetch(server.url))
      .text();
    expect(metadataLists).toBe(0);
  } finally {
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("independent servers pick up nested diagrams and index edits without restarting", async () => {
  await mkdir(`${tmpdir()}/devhost-e2e`, { recursive: true });
  const directory = await mkdtemp(`${tmpdir()}/devhost-e2e/architecture-`);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createArchitectureHandler(directory) });
  const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createArchitectureHandler(import.meta.dir) });
  try {
    expect(server.port).not.toBe(other.port);
    await Bun.write(`${directory}/index.md`, "---\nstatus: current\n---\n# First\n");
    let heading = "";
    await new HTMLRewriter()
      .on("h1", {
        text: (chunk) => {
          heading += chunk.text;
        },
      })
      .transform(await fetch(server.url))
      .text();
    expect(heading).toBe("First");
    await Bun.write(`${directory}/index.md`, "# Updated\n");
    heading = "";
    await new HTMLRewriter()
      .on("h1", {
        text: (chunk) => {
          heading += chunk.text;
        },
      })
      .transform(await fetch(server.url))
      .text();
    expect(heading).toBe("Updated");
    await mkdir(`${directory}/nested`);
    await Bun.write(`${directory}/nested/new.html`, "<!doctype html><title>New diagram</title>");
    const diagram = await fetch(new URL("nested/new.html", server.url));
    expect(diagram.status).toBe(200);
    expect(await diagram.text()).toBe(await Bun.file(`${directory}/nested/new.html`).text());
    const isolated = await fetch(new URL("nested/new.html", other.url));
    expect(isolated.status).toBe(404);
    await Bun.file(`${directory}/nested/new.html`).delete();
    const removed = await fetch(new URL("nested/new.html", server.url));
    expect(removed.status).toBe(404);
  } finally {
    await Promise.all([server.stop(true), other.stop(true)]);
    await rm(directory, { recursive: true, force: true });
  }
});
