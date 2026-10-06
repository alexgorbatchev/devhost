import assert from "node:assert/strict";

export async function adaptNativeReactCaddyfile(
  path: string,
  originalPath: string,
  adminAddress: string,
): Promise<void> {
  const file = Bun.file(path);
  if (!(await file.exists())) return;
  const source = await file.text();
  await Bun.write(`${originalPath}-${crypto.randomUUID()}`, source);
  assert(
    source.includes(`    admin ${adminAddress}\n`),
    "Refusing Caddy invocation outside this fixture-owned admin address.",
  );
  if (source.includes("skip_install_trust")) return;
  assert(source.startsWith("{\n"), "Unexpected generated Caddyfile global block.");
  await Bun.write(file, source.replace("{\n", "{\n    skip_install_trust\n"));
}
