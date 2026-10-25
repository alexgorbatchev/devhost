import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function createTestDirectory(): Promise<string> {
  const parentPath = resolve(import.meta.dir, "../../../../../.tmp/docs-site-links-tests");
  await mkdir(parentPath, { recursive: true });
  return mkdtemp(join(parentPath, "links-"));
}

// Writes a built site: each key is a file under the site root, each value its HTML body.
export async function writeSite(distPath: string, pages: Record<string, string>): Promise<void> {
  for (const [file, body] of Object.entries(pages)) {
    const path = join(distPath, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `<!doctype html><html><head><title>${file}</title></head><body>${body}</body></html>`);
  }
}
