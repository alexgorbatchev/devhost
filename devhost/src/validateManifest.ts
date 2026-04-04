import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { defaultBindHost } from "./constants";
import { createDefaultDevhostAgent } from "./createDefaultDevhostAgent";
import { defaultDevtoolsComponentEditor, supportedDevtoolsComponentEditors } from "./devtoolsComponentEditor";
import { isValidHost } from "./isValidHost";
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
} from "./stackTypes";

const devtoolsComponentEditorSchema = z.enum(supportedDevtoolsComponentEditors);
const devtoolsMinimapPositionSchema = z.enum(["left", "right"]);
const devtoolsPositionSchema = z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]);

const nonEmptyStringSchema = z.string().refine((value: string): boolean => value.trim().length > 0, {
  message: "Expected a non-empty string.",
});
const portSchema = z.union([z.number().int().min(1).max(65_535), z.literal("auto")]);
const healthSchema = z.union([
  z.object({ tcp: z.number().int().min(1).max(65_535) }).strict(),
  z.object({ http: z.string().url() }).strict(),
  z.object({ process: z.literal(true) }).strict(),
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
const serviceSchema = z
  .object({
    bindHost: z.enum(["127.0.0.1", "0.0.0.0", "::1", "::"]).optional(),
    command: z.array(nonEmptyStringSchema).min(1),
    cwd: z.string().optional(),
    dependsOn: z.array(nonEmptyStringSchema).optional(),
    env: z.record(z.string(), z.string()).optional(),
    port: portSchema.optional(),
    host: z.string().optional(),
    health: healthSchema.optional(),
  })
  .strict();
const manifestSchema = z
  .object({
    agent: agentSchema.optional(),
    devtools: z.boolean().optional(),
    devtoolsComponentEditor: devtoolsComponentEditorSchema.optional(),
    devtoolsMinimapPosition: devtoolsMinimapPositionSchema.optional(),
    devtoolsPosition: devtoolsPositionSchema.optional(),
    name: nonEmptyStringSchema,
    primaryService: nonEmptyStringSchema,
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

  if (!serviceNames.includes(parsedManifest.primaryService)) {
    errors.push(`primaryService must name an existing service, received: ${parsedManifest.primaryService}`);
  }

  const validatedServices: Record<string, IValidatedDevhostService> = {};
  const hosts: Set<string> = new Set<string>();
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
      hosts,
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
    devtools: parsedManifest.devtools ?? true,
    devtoolsComponentEditor: parsedManifest.devtoolsComponentEditor ?? defaultDevtoolsComponentEditor,
    devtoolsMinimapPosition: parsedManifest.devtoolsMinimapPosition ?? "right",
    devtoolsPosition: parsedManifest.devtoolsPosition ?? "bottom-right",
    manifestDirectoryPath,
    manifestPath,
    name: parsedManifest.name,
    primaryService: parsedManifest.primaryService,
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
  hosts: Set<string>,
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

    if (hosts.has(host)) {
      errors.push(`services.${serviceName}.host duplicates another routed service: ${host}`);
    }

    hosts.add(host);

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

  return {
    bindHost,
    command: serviceConfig.command,
    cwd,
    dependsOn,
    env,
    name: serviceName,
    port,
    host,
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
