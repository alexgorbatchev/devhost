import { readFile } from "node:fs/promises";

import { managedCaddyPaths } from "./caddyPaths";

type ReadFileFunction = (path: string) => Promise<Uint8Array>;
type StdoutWriter = (chunk: Uint8Array) => unknown;

interface IPrintManagedCaddyRootCertificateDependencies {
  readFile?: ReadFileFunction;
  rootCertificatePath?: string;
  writeStdout?: StdoutWriter;
}

export async function printManagedCaddyRootCertificate(
  dependencies: IPrintManagedCaddyRootCertificateDependencies = {},
): Promise<number> {
  const readFileImplementation: ReadFileFunction = dependencies.readFile ?? readFile;
  const rootCertificatePath: string = dependencies.rootCertificatePath ?? managedCaddyPaths.rootCertificatePath;
  const writeStdout: StdoutWriter = dependencies.writeStdout ?? defaultWriteStdout;

  try {
    const certificate: Uint8Array = await readFileImplementation(rootCertificatePath);

    writeStdout(certificate);
    return 0;
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) {
      throw new Error(
        `Managed Caddy root certificate not found at ${rootCertificatePath}. Run 'devhost caddy start' first.`,
      );
    }

    throw error;
  }
}

function defaultWriteStdout(chunk: Uint8Array): void {
  process.stdout.write(chunk);
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}
