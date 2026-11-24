import { fileURLToPath } from "node:url";
import inventory from "../rust/parity/inventory.json";

const rootPath = fileURLToPath(new URL("../../../", import.meta.url));

type GitTreeEntry = [string, string];

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: rootPath, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
  return result.stdout.toString().trim();
}

function isContract(path: string): boolean {
  return (
    (path.startsWith("apps/devhost/") &&
      path.endsWith(".go") &&
      !path.endsWith("_test.go") &&
      !/\/(testdata|browsertest|caddytest|nettest|testenv)\//.test(path)) ||
    path.startsWith("packages/docs/src/content/docs/") ||
    path.startsWith("skills/devhost/") ||
    path === "apps/devhost/README.md" ||
    path === "apps/devhost/devhost.example.toml"
  );
}

export async function verifyRustParity(reference: string): Promise<void> {
  const referenceSha = git("rev-parse", "--verify", `${reference}^{commit}`);
  if (referenceSha !== inventory.goSha) {
    throw new Error(
      `Go reference advanced: ${referenceSha}; inventory records ${inventory.goSha}. Reconcile the range and rerun affected comparisons.`,
    );
  }
  const entries = git("ls-tree", "-r", referenceSha).split("\n");
  const sources = new Map(
    entries
      .map((entry): GitTreeEntry => {
        const [metadata, path] = entry.split("\t");
        return [path ?? "", metadata?.split(" ")[2] ?? ""];
      })
      .filter(([path]) => path !== undefined && isContract(path)),
  );
  const failures: string[] = [];
  const ids = new Set<string>();
  const assigned = new Set<string>();
  const branchDifferences = new Map(inventory.branchDifferences.map((source) => [source.path, source]));
  for (const feature of inventory.features) {
    if (ids.has(feature.id)) failures.push(`Duplicate feature ${feature.id}`);
    ids.add(feature.id);
    if (!feature.contracts.length || !feature.rust.length || !feature.checks.length) {
      failures.push(`Incomplete feature ${feature.id}`);
    }
    for (const path of [...feature.rust, ...feature.checks]) {
      if (!(await Bun.file(`${rootPath}/${path}`).exists())) failures.push(`Missing evidence source: ${path}`);
    }
    for (const source of feature.go) {
      if (assigned.has(source.path)) failures.push(`Duplicate source ${source.path}`);
      assigned.add(source.path);
      if (sources.get(source.path) !== source.blob) failures.push(`Changed or removed Go contract: ${source.path}`);
      const branchDifference = branchDifferences.get(source.path);
      if (branchDifference && !branchDifference.reason) failures.push(`Unexplained branch difference: ${source.path}`);
      if (git("hash-object", "--", source.path) !== (branchDifference?.blob ?? source.blob))
        failures.push(`Working-tree contract differs: ${source.path}`);
    }
  }
  for (const path of sources.keys()) {
    if (!assigned.has(path)) failures.push(`Unassigned Go contract: ${path}`);
  }
  for (const path of branchDifferences.keys()) {
    if (!assigned.has(path)) failures.push(`Branch difference has no Go source: ${path}`);
  }
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(
    `Inventory complete: ${inventory.features.length} feature groups, ${sources.size} Go source/document contracts, Go ${referenceSha}.`,
  );
  console.log(
    "This checks inventory integrity, not behavior. Run the comparisons and native checks in docs/internal/references/rust-port-feature-matrix.md.",
  );
}

if (import.meta.main) {
  await verifyRustParity(Bun.argv[2] ?? "origin/main");
}
