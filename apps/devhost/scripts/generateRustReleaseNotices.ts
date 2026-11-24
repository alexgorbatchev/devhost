import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface ICargoLicensePackage {
  id: string;
  name: string;
  version: string;
  license: string | null;
  license_file: string | null;
  repository: string | null;
  source: string | null;
  manifest_path: string;
}

const repositoryDirectoryPath = resolve(import.meta.dir, "../../..");

function isCargoLicensePackage(value: unknown): value is ICargoLicensePackage {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "version" in value &&
    typeof value.version === "string" &&
    "license" in value &&
    (value.license === null || typeof value.license === "string") &&
    "license_file" in value &&
    (value.license_file === null || typeof value.license_file === "string") &&
    "repository" in value &&
    (value.repository === null || typeof value.repository === "string") &&
    "source" in value &&
    (value.source === null || typeof value.source === "string") &&
    "manifest_path" in value &&
    typeof value.manifest_path === "string"
  );
}

// Cargo's emitted artifacts select the actual target graph, including Git and path dependencies.
export async function generateRustReleaseNotices(metadata: unknown, artifactLog: string): Promise<string> {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    !("packages" in metadata) ||
    !Array.isArray(metadata.packages)
  ) {
    throw new Error("Cargo metadata did not contain packages.");
  }
  const packages = new Map<string, ICargoLicensePackage>();
  for (const value of metadata.packages) {
    if (!isCargoLicensePackage(value)) throw new Error("Invalid Cargo package license metadata.");
    packages.set(value.id, value);
  }
  const used = new Set<string>();
  for (const line of artifactLog.trim().split("\n")) {
    const artifact: unknown = JSON.parse(line);
    if (
      typeof artifact === "object" &&
      artifact !== null &&
      "reason" in artifact &&
      artifact.reason === "compiler-artifact" &&
      "package_id" in artifact &&
      typeof artifact.package_id === "string"
    ) {
      used.add(artifact.package_id);
    }
  }
  if (used.size === 0) throw new Error("Cargo reported no compiled packages for license collection.");
  const sections: string[] = [
    "Rust executable third-party notices\nIncludes linked packages and build-time dependencies reported by Cargo.\n",
  ];
  for (const id of [...used].sort()) {
    const item = packages.get(id);
    if (!item) throw new Error(`Compiled package is missing from Cargo metadata: ${id}`);
    const directoryPath = dirname(item.manifest_path);
    const licenseFilePaths = new Set<string>();
    for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
      if (entry.isFile() && /^(LICENSE|LICENCE|COPYING|COPYRIGHT|NOTICE|UNLICENSE)([.-]|$)/i.test(entry.name)) {
        licenseFilePaths.add(join(directoryPath, entry.name));
      }
    }
    if (item.license_file) licenseFilePaths.add(resolve(directoryPath, item.license_file));
    if (item.name === "devhost-rust" && directoryPath === join(repositoryDirectoryPath, "apps/devhost/rust")) {
      licenseFilePaths.add(join(repositoryDirectoryPath, "LICENSE"));
    }
    // These crates omit their upstream license file. The checked-in override is pinned to their crate VCS revision.
    if (
      (item.name === "include_dir" || item.name === "include_dir_macros") &&
      item.version === "0.7.4" &&
      item.repository === "https://github.com/Michael-F-Bryan/include_dir"
    ) {
      licenseFilePaths.add(join(repositoryDirectoryPath, "apps/devhost/rust/licenses/include_dir-0.7.4-MIT.txt"));
    }
    if (!licenseFilePaths.size)
      throw new Error(`No bundled license text for ${item.name} ${item.version} (${item.license ?? "unspecified"}).`);
    const source = item.source ?? (item.name === "devhost-rust" ? "this repository" : "vendored dependency");
    sections.push(
      `${item.name} ${item.version}\nLicense: ${item.license ?? "see license text"}\nSource: ${source}\nRepository: ${item.repository ?? "this repository"}`,
    );
    for (const filePath of [...licenseFilePaths].sort()) {
      const content = await Bun.file(filePath).text();
      if (!content.trim()) throw new Error(`Empty dependency license: ${item.name} ${item.version}`);
      sections.push(content.trim());
    }
  }
  return `${sections.join("\n\n------------------------------------------------------------\n\n")}\n`;
}
