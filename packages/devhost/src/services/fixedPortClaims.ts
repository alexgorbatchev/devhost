import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface IFixedPortClaim {
  bindHost: string;
  createdAt: string;
  manifestPath: string;
  ownerPid: number;
  port: number;
}

export interface IClaimFixedPortOptions {
  bindHost: string;
  manifestPath: string;
  port: number;
  portClaimsDirectoryPath: string;
}

export async function claimFixedPort(options: IClaimFixedPortOptions): Promise<void> {
  const claimPath: string = getFixedPortClaimPath(options.bindHost, options.port, options.portClaimsDirectoryPath);
  const claimText: string = createFixedPortClaimText(options.bindHost, options.manifestPath, options.port);

  try {
    await writeFile(claimPath, claimText, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error: unknown) {
    if (!isErrorWithCode(error) || error.code !== "EEXIST") {
      throw error;
    }

    const existingClaim: IFixedPortClaim = parseFixedPortClaim(await readFile(claimPath, "utf8"));

    if (!isFixedPortClaimStale(existingClaim)) {
      throw new Error(
        `Fixed bind port ${options.bindHost}:${options.port} is already claimed by PID ${existingClaim.ownerPid} from ${existingClaim.manifestPath}.`,
      );
    }

    await rm(claimPath, { force: true });
    await writeFile(claimPath, claimText, {
      encoding: "utf8",
      flag: "wx",
    });
  }
}

export async function releaseFixedPortClaim(options: IClaimFixedPortOptions): Promise<void> {
  const claimPath: string = getFixedPortClaimPath(options.bindHost, options.port, options.portClaimsDirectoryPath);

  try {
    const claim: IFixedPortClaim = parseFixedPortClaim(await readFile(claimPath, "utf8"));

    if (claim.ownerPid !== process.pid || claim.manifestPath !== options.manifestPath) {
      return;
    }
  } catch (error) {
    if (isErrorWithCode(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }

  await rm(claimPath, { force: true });
}

export async function cleanupStaleFixedPortClaims(portClaimsDirectoryPath: string): Promise<void> {
  const claimFileNames: string[] = await readdir(portClaimsDirectoryPath);

  for (const claimFileName of claimFileNames) {
    if (!claimFileName.endsWith(".json")) {
      continue;
    }

    const claimPath: string = join(portClaimsDirectoryPath, claimFileName);
    const claim: IFixedPortClaim = parseFixedPortClaim(await readFile(claimPath, "utf8"));

    if (!isFixedPortClaimStale(claim)) {
      continue;
    }

    await rm(claimPath, { force: true });
  }
}

export function createFixedPortClaimText(bindHost: string, manifestPath: string, port: number): string {
  const claim: IFixedPortClaim = {
    bindHost,
    createdAt: new Date().toISOString(),
    manifestPath,
    ownerPid: process.pid,
    port,
  };

  return JSON.stringify(claim, null, 2);
}

function getFixedPortClaimPath(bindHost: string, port: number, portClaimsDirectoryPath: string): string {
  return join(portClaimsDirectoryPath, `${readFixedPortClaimScope(bindHost)}_${port}.json`);
}

function readFixedPortClaimScope(bindHost: string): string {
  if (bindHost === "127.0.0.1" || bindHost === "0.0.0.0") {
    return "ipv4";
  }

  if (bindHost === "::1" || bindHost === "::") {
    return "ipv6";
  }

  return encodePathSegment(bindHost);
}

function encodePathSegment(value: string): string {
  return value.replaceAll(":", "_");
}

function isFixedPortClaimStale(claim: IFixedPortClaim): boolean {
  if (claim.ownerPid === process.pid) {
    return false;
  }

  return !isProcessAlive(claim.ownerPid);
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function parseFixedPortClaim(claimText: string): IFixedPortClaim {
  const parsedValue: unknown = JSON.parse(claimText);

  if (!isFixedPortClaim(parsedValue)) {
    throw new Error("Fixed port claim is malformed.");
  }

  return parsedValue;
}

function isFixedPortClaim(value: unknown): value is IFixedPortClaim {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "bindHost") === "string" &&
    typeof Reflect.get(value, "createdAt") === "string" &&
    typeof Reflect.get(value, "manifestPath") === "string" &&
    typeof Reflect.get(value, "ownerPid") === "number" &&
    typeof Reflect.get(value, "port") === "number"
  );
}

type ErrorWithCode = Error & { code: string };

function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return error instanceof Error && typeof Reflect.get(error, "code") === "string";
}
