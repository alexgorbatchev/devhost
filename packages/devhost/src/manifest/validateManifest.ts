import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { defaultBindHost } from "../utils/constants";
import { createDefaultDevhostAgent } from "../agents/createDefaultDevhostAgent";
import {
  defaultDevtoolsComponentEditor,
  supportedDevtoolsComponentEditors,
} from "../devtools-server/devtoolsComponentEditor";
import { isValidHost } from "../utils/isValidHost";
import type {
  DevhostAgentConfig,
  DevhostPortConfig,
  DevhostHealthConfig,
  IConfiguredDevhostAgent,
  IDevhostManifest,
  IDevhostServiceConfig,
  ValidatedDevhostAgent,
  IValidatedDevhostManifest,
  IValidatedDevhostService,
} from "../types/stackTypes";

const devtoolsComponentEditorSchema = z.enum(supportedDevtoolsComponentEditors);
const devtoolsMinimapPositionSchema = z.enum(["left", "right"]);
const devtoolsPositionSchema = z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]);

const nonEmptyStringSchema = z.string().refine((value: string): boolean => value.trim().length > 0, {
  message: "Expected a non-empty string.",
});
const portSchema = z.union([z.number().int().min(1).max(65_535), z.literal("auto")]);
const healthBaseSchema = z.object({
  interval: z.number().int().min(1).optional(),
  timeout: z.number().int().min(1).optional(),
  retries: z.number().int().min(0).optional(),
});

const healthSchema = z.union([
  z
    .object({ tcp: z.number().int().min(1).max(65_535) })
    .merge(healthBaseSchema)
    .strict(),
  z.object({ http: z.string().url() }).merge(healthBaseSchema).strict(),
  z
    .object({ process: z.literal(true) })
    .merge(healthBaseSchema)
    .strict(),
]);
const agentAdapterSchema = z.enum(["pi", "claude-code", "opencode"]);

const agentSchema = z.union([
  z
    .object({
      adapter: agentAdapterSchema,
    })
    .strict(),
  z
    .object({
      command: z.array(nonEmptyStringSchema).min(1),
      cwd: z.string().optional(),
      displayName: nonEmptyStringSchema,
      env: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
]);
const commandSchema = z.union([nonEmptyStringSchema, z.array(nonEmptyStringSchema).min(1)]);

const serviceSchema = z
  .object({
    primary: z.boolean().optional(),
    bindHost: z.enum(["127.0.0.1", "0.0.0.0", "::1", "::"]).optional(),
    command: commandSchema,
    cwd: z.string().optional(),
    dependsOn: z.array(nonEmptyStringSchema).optional(),
    env: z.record(z.string(), z.string()).optional(),
    port: portSchema.optional(),
    host: z.string().optional(),
    path: nonEmptyStringSchema.optional(),
    health: healthSchema.optional(),
  })
  .strict();
const manifestSchema = z
  .object({
    agent: agentSchema.optional(),
    devtools: z
      .object({
        editor: z
          .object({
            enabled: z.boolean().optional(),
            ide: devtoolsComponentEditorSchema.optional(),
          })
          .optional(),
        minimap: z
          .object({
            enabled: z.boolean().optional(),
            position: devtoolsMinimapPositionSchema.optional(),
          })
          .optional(),
        status: z
          .object({
            enabled: z.boolean().optional(),
            position: devtoolsPositionSchema.optional(),
          })
          .optional(),
      })
      .optional(),
    name: nonEmptyStringSchema,
    services: z.record(z.string(), serviceSchema),
  })
  .strict();
const serviceNamePattern: RegExp = /^[a-z][a-z0-9-]*$/;

export function validateManifest(manifestPath: string, manifestValue: unknown): IValidatedDevhostManifest {
  const parseResult = manifestSchema.safeParse(manifestValue);

  if (!parseResult.success) {
    const issuesText: string = parseResult.error.issues
      .map((issue) => `${formatIssuePath(issue.path)} ${issue.message}`.trim())
      .join("\n");
    throw new Error(`Manifest schema is invalid:\n${issuesText}`);
  }

  const parsedManifest: IDevhostManifest = parseResult.data;
  const manifestDirectoryPath: string = dirname(manifestPath);
  const serviceNames: string[] = Object.keys(parsedManifest.services);
  const errors: string[] = [];

  if (serviceNames.length === 0) {
    errors.push("services must contain at least one service.");
  }

  const primaryServices = serviceNames.filter((name) => parsedManifest.services[name].primary);
  let resolvedPrimaryService = serviceNames[0];

  if (primaryServices.length > 1) {
    errors.push(`Multiple primary services defined: ${primaryServices.join(", ")}`);
  } else if (primaryServices.length === 1) {
    resolvedPrimaryService = primaryServices[0];
  }

  const validatedServices: Record<string, IValidatedDevhostService> = {};
  const routedPaths: Set<string> = new Set<string>();
  const fixedBindPorts: Set<string> = new Set<string>();

  for (const [serviceName, serviceConfig] of Object.entries(parsedManifest.services)) {
    if (!serviceNamePattern.test(serviceName)) {
      errors.push(`services.${serviceName} has an invalid name.`);
      continue;
    }

    const validatedService: IValidatedDevhostService = validateService(
      serviceName,
      serviceConfig,
      manifestDirectoryPath,
      serviceNames,
      routedPaths,
      fixedBindPorts,
      errors,
    );

    validatedServices[serviceName] = validatedService;
  }

  const validatedAgent: ValidatedDevhostAgent = validateAgent(parsedManifest.agent, manifestDirectoryPath, errors);

  if (errors.length > 0) {
    throw new Error(`Manifest validation failed:\n${errors.join("\n")}`);
  }

  return {
    agent: validatedAgent,
    devtools: {
      editor: {
        enabled: parsedManifest.devtools?.editor?.enabled ?? true,
        ide: parsedManifest.devtools?.editor?.ide ?? defaultDevtoolsComponentEditor,
      },
      minimap: {
        enabled: parsedManifest.devtools?.minimap?.enabled ?? true,
        position: parsedManifest.devtools?.minimap?.position ?? "right",
      },
      status: {
        enabled: parsedManifest.devtools?.status?.enabled ?? true,
        position: parsedManifest.devtools?.status?.position ?? "bottom-right",
      },
    },
    manifestDirectoryPath,
    manifestPath,
    name: parsedManifest.name,
    primaryService: resolvedPrimaryService,
    services: validatedServices,
  };
}

function validateAgent(
  agentConfig: DevhostAgentConfig | undefined,
  manifestDirectoryPath: string,
  errors: string[],
): ValidatedDevhostAgent {
  if (agentConfig === undefined) {
    return createDefaultDevhostAgent();
  }

  if ("adapter" in agentConfig) {
    let displayName = "Pi";
    if (agentConfig.adapter === "claude-code") displayName = "Claude Code";
    if (agentConfig.adapter === "opencode") displayName = "OpenCode";

    return {
      displayName,
      kind: agentConfig.adapter,
    };
  }

  const cwd: string = resolveConstrainedPath("agent.cwd", agentConfig.cwd ?? ".", manifestDirectoryPath, errors);

  return {
    command: agentConfig.command,
    cwd,
    displayName: agentConfig.displayName,
    env: agentConfig.env ?? {},
    kind: "configured",
  } satisfies IConfiguredDevhostAgent;
}

function validateService(
  serviceName: string,
  serviceConfig: IDevhostServiceConfig,
  manifestDirectoryPath: string,
  serviceNames: string[],
  routedPaths: Set<string>,
  fixedBindPorts: Set<string>,
  errors: string[],
): IValidatedDevhostService {
  const cwd: string = resolveConstrainedPath(
    `services.${serviceName}.cwd`,
    serviceConfig.cwd ?? ".",
    manifestDirectoryPath,
    errors,
  );
  const bindHost: string = serviceConfig.bindHost ?? defaultBindHost;
  const dependsOn: string[] = serviceConfig.dependsOn ?? [];
  const env: Record<string, string> = serviceConfig.env ?? {};
  const port: DevhostPortConfig | null = serviceConfig.port ?? null;
  const host: string | null = serviceConfig.host ?? null;
  const path: string | null = host !== null ? (serviceConfig.path ?? "/") : null;
  const health: DevhostHealthConfig | null = serviceConfig.health ?? null;

  for (const dependencyName of dependsOn) {
    if (!serviceNames.includes(dependencyName)) {
      errors.push(`services.${serviceName}.dependsOn references an unknown service: ${dependencyName}`);
    }
  }

  if (host !== null) {
    if (!isValidHost(host)) {
      errors.push(`services.${serviceName}.host must be a valid hostname, received: ${host}`);
    }

    const routeKey = path === "/" ? host : `${host}${path}`;
    if (routedPaths.has(routeKey)) {
      errors.push(`services.${serviceName}.host and path duplicate another routed service: ${routeKey}`);
    }

    routedPaths.add(routeKey);

    if (port === null) {
      errors.push(`services.${serviceName}.host requires services.${serviceName}.port.`);
    }
  }

  if (health !== null && "process" in health && host !== null) {
    errors.push(`services.${serviceName} must not use health.process on a routed service.`);
  }

  if (port === "auto" && health !== null) {
    errors.push(`services.${serviceName} must omit health when port = "auto" in v1.`);
  }

  if (port === null && health === null) {
    errors.push(`services.${serviceName} must define either port or health.`);
  }

  if (health !== null && "http" in health) {
    validateHealthHttp(serviceName, health.http, errors);
  }

  if (typeof port === "number") {
    const fixedBindPortKey: string = `${bindHost}:${port}`;

    if (fixedBindPorts.has(fixedBindPortKey)) {
      errors.push(`services.${serviceName} duplicates fixed bind port ${fixedBindPortKey}.`);
    }

    fixedBindPorts.add(fixedBindPortKey);
  }

  let command: string[];
  if (typeof serviceConfig.command === "string") {
    // Basic space separation since Bun.spawn can actually use this cleanly
    command = serviceConfig.command.split(/\s+/).filter(Boolean);
  } else {
    command = serviceConfig.command;
  }

  return {
    bindHost,
    command,
    cwd,
    dependsOn,
    env,
    name: serviceName,
    port,
    host,
    path,
    health,
  };
}

function resolveConstrainedPath(
  fieldPath: string,
  candidatePath: string,
  manifestDirectoryPath: string,
  errors: string[],
): string {
  const resolvedPath: string = resolve(manifestDirectoryPath, candidatePath);
  const relativePath: string = relative(manifestDirectoryPath, resolvedPath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    errors.push(`${fieldPath} must stay within ${manifestDirectoryPath}.`);
  }

  return resolvedPath;
}

function validateHealthHttp(serviceName: string, rawUrl: string, errors: string[]): void {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    errors.push(`services.${serviceName}.health.http must be an absolute URL, received: ${rawUrl}`);
    return;
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
    errors.push(`services.${serviceName}.health.http must target 127.0.0.1, localhost, or ::1.`);
  }
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "manifest";
  }

  return path.join(".");
}
