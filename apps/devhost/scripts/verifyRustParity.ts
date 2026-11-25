import { fileURLToPath } from "node:url";
import inventory from "../rust/parity/inventory.json";
import obligations from "../rust/parity/obligations.json";

const rootPath = fileURLToPath(new URL("../../../", import.meta.url));

type GitTreeEntry = [string, string];
type BehaviorContract = { feature: string; contract: string };
type ContractEntry = [string, BehaviorContract];

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
  if (obligations.goSha !== inventory.goSha) failures.push("Obligation map uses a different Go reference");
  const evidenceIds = new Set<string>();
  for (const evidence of obligations.evidence) {
    if (evidenceIds.has(evidence.id)) failures.push(`Duplicate evidence ${evidence.id}`);
    evidenceIds.add(evidence.id);
    if (!evidence.kind || !evidence.selector || !(await Bun.file(`${rootPath}/${evidence.path}`).exists())) {
      failures.push(`Incomplete obligation evidence ${evidence.id}`);
    }
  }
  const contracts = new Map(
    inventory.features.flatMap((feature) =>
      feature.contracts.map(
        (contract, index): ContractEntry => [`${feature.id}.${index + 1}`, { feature: feature.id, contract }],
      ),
    ),
  );
  const caseIds = new Set<string>();
  for (const obligation of obligations.cases) {
    const expected = contracts.get(obligation.id);
    if (caseIds.has(obligation.id)) failures.push(`Duplicate obligation ${obligation.id}`);
    caseIds.add(obligation.id);
    if (expected?.feature !== obligation.feature || expected.contract !== obligation.contract) {
      failures.push(`Changed or unknown obligation ${obligation.id}`);
    }
    if (
      ![obligation.trigger, obligation.effect, obligation.failure, obligation.cleanup, obligation.remaining].every(
        Boolean,
      ) ||
      !obligation.evidence.length ||
      obligation.evidence.some((id) => !evidenceIds.has(id))
    ) {
      failures.push(`Incomplete acceptance case ${obligation.id}`);
    }
  }
  for (const id of contracts.keys()) {
    if (!caseIds.has(id)) failures.push(`Unassigned behavior obligation ${id}`);
  }
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
  const additions = new Set<string>();
  for (const source of inventory.branchAdditions) {
    if (additions.has(source.path) || sources.has(source.path) || !isContract(source.path)) {
      failures.push(`Invalid branch addition: ${source.path}`);
    }
    additions.add(source.path);
    if (!ids.has(source.feature) || !source.reason || git("hash-object", "--", source.path) !== source.blob) {
      failures.push(`Changed or unexplained branch addition: ${source.path}`);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  console.log(
    `Inventory complete: ${inventory.features.length} feature groups, ${sources.size} Go source/document contracts, ${caseIds.size} acceptance cases, Go ${referenceSha}.`,
  );
  console.log(
    "This checks inventory integrity, not behavior. Run the comparisons and native checks in docs/internal/references/rust-port-feature-matrix.md.",
  );
}

if (import.meta.main) {
  await verifyRustParity(Bun.argv[2] ?? "golang");
}
