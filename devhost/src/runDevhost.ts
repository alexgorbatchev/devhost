import { helpText } from "./utils/constants";
import type { IDevhostLogger } from "./utils/createLogger";
import { parseCommandLineArguments } from "./manifest/parseCommandLineArguments";
import { runManagedCaddyLifecycleCommand } from "./caddy/runManagedCaddyLifecycleCommand";
import { readManifest } from "./manifest/readManifest";
import { resolveManifestPath } from "./manifest/resolveManifestPath";
import { resolveServiceOrder } from "./services/resolveServiceOrder";
import { resolveServicePorts } from "./services/resolveServicePorts";
import { startSingleService } from "./services/startSingleService";
import { startStack } from "./services/startStack";
import { validateManifest } from "./manifest/validateManifest";

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
