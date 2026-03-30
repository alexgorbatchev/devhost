import { helpText } from "./constants";
import { parseCommandLineArguments } from "./parseCommandLineArguments";
import { readManifest } from "./readManifest";
import { resolveManifestPath } from "./resolveManifestPath";
import { resolveServiceOrder } from "./resolveServiceOrder";
import { resolveServicePorts } from "./resolveServicePorts";
import { startSingleService } from "./startSingleService";
import { startStack } from "./startStack";
import { validateManifest } from "./validateManifest";

export async function runDevhost(rawArguments: string[]): Promise<number> {
  try {
    if (rawArguments.includes("--help") || rawArguments.includes("-h")) {
      console.log(helpText);
      return 0;
    }

    const commandLineArguments = parseCommandLineArguments(rawArguments);

    if (commandLineArguments.kind === "single-service") {
      return await startSingleService(commandLineArguments);
    }

    const manifestPath: string =
      commandLineArguments.manifestPath ?? (await resolveManifestPath(process.cwd()));
    const manifestValue: unknown = await readManifest(manifestPath);
    const validatedManifest = validateManifest(manifestPath, manifestValue);
    const serviceOrder: string[] = resolveServiceOrder(validatedManifest);
    const resolvedManifest = await resolveServicePorts(validatedManifest);

    return await startStack(resolvedManifest, serviceOrder);
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    console.error(`devhost failed: ${message}`);
    return 1;
  }
}
