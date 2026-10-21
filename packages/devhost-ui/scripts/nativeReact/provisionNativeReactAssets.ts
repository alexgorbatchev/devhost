import assert from "node:assert/strict";
import { mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { assertReactExtensionManifest } from "./assertReactExtensionManifest";
import { readCrxPublicKey } from "./readCrxPublicKey";
import { nativeReactChromeForTestingListingUrl, nativeReactExtensionId } from "./constants";
import { resolveChromeForTestingPlatform } from "./resolveChromeForTestingPlatform";
import { selectChromeForTestingRelease } from "./selectChromeForTestingRelease";
import type { IChromeForTestingRelease } from "./types";

export interface IProvisionedNativeReactAssets {
  chromeExecutablePath: string;
  chromeVersion: string;
  reactExtensionDirectoryPath: string;
  reactExtensionVersion: string;
}

async function download(url: string, path: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  // A partial file never takes the final name, so an interrupted download is fetched again.
  const partialPath = `${path}.partial`;
  await Bun.write(partialPath, response);
  await rename(partialPath, path);
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

function unzip(archivePath: string, directoryPath: string): void {
  const result = Bun.spawnSync(["unzip", "-q", "-o", archivePath, "-d", directoryPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
}

// Chromium's CRX3 container precedes the unchanged ZIP payload with magic, version, and a little-endian
// protobuf-header length (crx_verifier.cc).
function readCrxArchive(crx: Uint8Array): Uint8Array {
  const header = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  assert.equal(new TextDecoder().decode(crx.subarray(0, 4)), "Cr24", "React Developer Tools download is not a CRX.");
  assert.equal(header.getUint32(4, true), 3, "React Developer Tools download is not a CRX3 container.");
  const archiveOffset = 12 + header.getUint32(8, true);
  assert(archiveOffset < crx.byteLength);
  return crx.subarray(archiveOffset);
}

async function readCurrentRelease(platformName: string): Promise<IChromeForTestingRelease> {
  const response = await fetch(nativeReactChromeForTestingListingUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Chrome for Testing listing failed (${response.status})`);
  return selectChromeForTestingRelease(await response.json(), platformName);
}

// Unpacks the current Stable Chrome for Testing for this platform and the current React Developer Tools release from
// the Chrome Web Store into directoryPath. Chrome archives are kept in downloadsPath, one per version, so a later run
// downloads again only when Stable moves.
export async function provisionNativeReactAssets(
  directoryPath: string,
  downloadsPath: string,
): Promise<IProvisionedNativeReactAssets> {
  const platform = resolveChromeForTestingPlatform(process.platform, process.arch);
  const release = await readCurrentRelease(platform.name);
  await mkdir(downloadsPath, { recursive: true });
  await mkdir(directoryPath, { recursive: true });

  const chromeArchivePath = resolve(downloadsPath, `chrome-${release.version}-${platform.name}.zip`);
  if (!(await Bun.file(chromeArchivePath).exists())) await download(release.url, chromeArchivePath);
  const chromeDirectoryPath = resolve(directoryPath, "chrome");
  unzip(chromeArchivePath, chromeDirectoryPath);
  const chromeExecutablePath = resolve(chromeDirectoryPath, platform.executablePath);

  // The Web Store serves the release its update service offers this Chrome version.
  const crxUrl =
    "https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx3" +
    `&prodversion=${release.version}&x=id%3D${nativeReactExtensionId}%26uc`;
  const crxPath = resolve(directoryPath, "react-devtools.crx");
  await download(crxUrl, crxPath);
  const crx = await Bun.file(crxPath).bytes();
  const extensionArchivePath = resolve(directoryPath, "react-devtools.zip");
  await Bun.write(extensionArchivePath, readCrxArchive(crx));
  const reactExtensionDirectoryPath = resolve(directoryPath, "react-devtools");
  unzip(extensionArchivePath, reactExtensionDirectoryPath);
  const manifestPath = resolve(reactExtensionDirectoryPath, "manifest.json");
  const manifest: unknown = await Bun.file(manifestPath).json();
  const reactExtensionVersion = assertReactExtensionManifest(manifest);
  // Chrome names an unpacked extension after its directory unless the manifest carries the extension's public key.
  // With the key the extension keeps its Web Store ID, the one devhost's [devtools.browser] default expects.
  const { publicKey, extensionId } = readCrxPublicKey(crx);
  assert.equal(extensionId, nativeReactExtensionId, "React Developer Tools download carries another extension's key.");
  assert(typeof manifest === "object" && manifest !== null);
  await Bun.write(manifestPath, JSON.stringify({ ...manifest, key: publicKey }, null, 2));

  const versionResult = Bun.spawnSync([chromeExecutablePath, "--version"], { stdout: "pipe", stderr: "pipe" });
  assert.equal(versionResult.exitCode, 0, versionResult.stderr.toString());
  const reportedVersion = versionResult.stdout.toString().trim();
  assert.equal(reportedVersion, `Google Chrome for Testing ${release.version}`);

  await Bun.write(
    resolve(directoryPath, "provisioning-proof.json"),
    JSON.stringify(
      {
        platform,
        chrome: {
          version: release.version,
          url: release.url,
          sha256: sha256(await Bun.file(chromeArchivePath).bytes()),
          reportedVersion,
        },
        reactDevtools: { version: reactExtensionVersion, url: crxUrl, sha256: sha256(crx) },
      },
      null,
      2,
    ),
  );
  return { chromeExecutablePath, chromeVersion: release.version, reactExtensionDirectoryPath, reactExtensionVersion };
}
