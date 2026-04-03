import { helpText } from "./constants";
import type { IDevhostLogger } from "./createLogger";
import { parseCommandLineArguments } from "./parseCommandLineArguments";
import { runManagedCaddyLifecycleCommand } from "./runManagedCaddyLifecycleCommand";
import { readManifest } from "./readManifest";
import { resolveManifestPath } from "./resolveManifestPath";
import { resolveServiceOrder } from "./resolveServiceOrder";
import { resolveServicePorts } from "./resolveServicePorts";
import { startSingleService } from "./startSingleService";
import { startStack } from "./startStack";
import { validateManifest } from "./validateManifest";

export async function runDevhost(rawArguments: string[], logger: IDevhostLogger): Promise<number> {
  let activeLogger: IDevhostLogger = logger;

  try {
    if (rawArguments.includes("--help") || rawArguments.includes("-h")) {
      logger.info(helpText);
      return 0;
    }

    const commandLineArguments = parseCommandLineArguments(rawArguments);

    if (commandLineArguments.kind === "caddy") {
      return await runManagedCaddyLifecycleCommand(commandLineArguments.action, logger);
    }

    if (commandLineArguments.kind === "single-service") {
      return await startSingleService(commandLineArguments, logger);
    }

    const manifestPath: string = commandLineArguments.manifestPath ?? (await resolveManifestPath(process.cwd()));
    const manifestValue: unknown = await readManifest(manifestPath);
    const validatedManifest = validateManifest(manifestPath, manifestValue);

    activeLogger = logger.withLabel(validatedManifest.name);

    const serviceOrder: string[] = resolveServiceOrder(validatedManifest);
    const resolvedManifest = await resolveServicePorts(validatedManifest);

    return await startStack(resolvedManifest, serviceOrder, activeLogger);
  } catch (error: unknown) {
    const message: string = error instanceof Error ? error.message : String(error);
    activeLogger.error(`failed: ${message}`);
    return 1;
  }
}
