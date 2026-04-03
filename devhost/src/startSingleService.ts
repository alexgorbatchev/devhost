import { join } from "node:path";

import { defaultBindHost } from "./constants";
import { createDefaultDevhostAgent } from "./createDefaultDevhostAgent";
import { readDevtoolsComponentEditorValue } from "./devtoolsComponentEditor";
import type { IDevhostLogger } from "./createLogger";
import type { ISingleServiceCommandLineArguments } from "./parseCommandLineArguments";
import { createInjectedServiceEnvironment, startStack } from "./startStack";
import type { IInjectedServiceEnvironment, IResolvedDevhostManifest, IResolvedDevhostService } from "./stackTypes";

const syntheticManifestFileName: string = "devhost.synthetic.toml";
const syntheticStackName: string = "devhost";
const devtoolsComponentEditorEnvironmentVariableName: string = "DEVHOST_COMPONENT_EDITOR";

export function createSingleServiceEnvironment(
  arguments_: ISingleServiceCommandLineArguments,
): IInjectedServiceEnvironment {
  const manifest: IResolvedDevhostManifest = createSingleServiceManifest(arguments_);
  const service: IResolvedDevhostService = manifest.services[manifest.primaryService];

  return createInjectedServiceEnvironment(manifest, service, "single-service");
}

export function createSingleServiceManifest(arguments_: ISingleServiceCommandLineArguments): IResolvedDevhostManifest {
  const service: IResolvedDevhostService = {
    bindHost: defaultBindHost,
    command: arguments_.command,
    cwd: process.cwd(),
    dependsOn: [],
    env: {},
    health: {
      host: defaultBindHost,
      kind: "tcp",
      port: arguments_.port,
    },
    host: arguments_.host,
    name: arguments_.host,
    port: arguments_.port,
    portSource: "fixed",
  };

  return {
    agent: createDefaultDevhostAgent(),
    devtools: true,
    devtoolsComponentEditor: readDevtoolsComponentEditorValue(
      process.env[devtoolsComponentEditorEnvironmentVariableName],
    ),
    devtoolsMinimapPosition: "right",
    devtoolsPosition: "bottom-right",
    manifestDirectoryPath: process.cwd(),
    manifestPath: join(process.cwd(), syntheticManifestFileName),
    name: syntheticStackName,
    primaryService: service.name,
    services: {
      [service.name]: service,
    },
  };
}

export async function startSingleService(
  arguments_: ISingleServiceCommandLineArguments,
  logger: IDevhostLogger,
): Promise<number> {
  const manifest: IResolvedDevhostManifest = createSingleServiceManifest(arguments_);

  return await startStack(manifest, [manifest.primaryService], logger, {
    pipeServiceOutput: false,
    runtimeMode: "single-service",
    stdinMode: "inherit",
  });
}
