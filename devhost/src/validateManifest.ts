import { dirname, isAbsolute, relative, resolve } from "node:path";

import { z } from "zod";

import { defaultBindHost } from "./constants";
import { isValidHost } from "./isValidHost";
import type {
  DevhostPortConfig,
  DevhostReadyConfig,
  IDevhostManifest,
  IDevhostServiceConfig,
  IValidatedDevhostManifest,
  IValidatedDevhostService,
} from "./stackTypes";

const nonEmptyStringSchema = z.string().refine((value: string): boolean => value.trim().length > 0, {
  message: "Expected a non-empty string.",
});
const portSchema = z.union([z.number().int().min(1).max(65_535), z.literal("auto")]);
const readySchema = z.union([
  z.object({ tcp: z.number().int().min(1).max(65_535) }).strict(),
  z.object({ http: z.string().url() }).strict(),
  z.object({ process: z.literal(true) }).strict(),
]);
const serviceSchema = z
  .object({
    bindHost: z.enum(["127.0.0.1", "0.0.0.0", "::1", "::"]).optional(),
    command: z.array(nonEmptyStringSchema).min(1),
    cwd: z.string().optional(),
    dependsOn: z.array(nonEmptyStringSchema).optional(),
    env: z.record(z.string(), z.string()).optional(),
    port: portSchema.optional(),
    publicHost: z.string().optional(),
    ready: readySchema.optional(),
  })
  .strict();
const manifestSchema = z
  .object({
    devtools: z.boolean().optional(),
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
  const publicHosts: Set<string> = new Set<string>();
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
      publicHosts,
      fixedBindPorts,
      errors,
    );

    validatedServices[serviceName] = validatedService;
  }

  if (errors.length > 0) {
    throw new Error(`Manifest validation failed:\n${errors.join("\n")}`);
  }

  return {
    devtools: parsedManifest.devtools ?? true,
    manifestDirectoryPath,
    manifestPath,
    name: parsedManifest.name,
    primaryService: parsedManifest.primaryService,
    services: validatedServices,
  };
}

function validateService(
  serviceName: string,
  serviceConfig: IDevhostServiceConfig,
  manifestDirectoryPath: string,
  serviceNames: string[],
  publicHosts: Set<string>,
  fixedBindPorts: Set<string>,
  errors: string[],
): IValidatedDevhostService {
  const cwd: string = resolve(manifestDirectoryPath, serviceConfig.cwd ?? ".");
  const bindHost: string = serviceConfig.bindHost ?? defaultBindHost;
  const dependsOn: string[] = serviceConfig.dependsOn ?? [];
  const env: Record<string, string> = serviceConfig.env ?? {};
  const port: DevhostPortConfig | null = serviceConfig.port ?? null;
  const publicHost: string | null = serviceConfig.publicHost ?? null;
  const ready: DevhostReadyConfig | null = serviceConfig.ready ?? null;
  const relativeCwdPath: string = relative(manifestDirectoryPath, cwd);

  if (relativeCwdPath.startsWith("..") || isAbsolute(relativeCwdPath)) {
    errors.push(`services.${serviceName}.cwd must stay within ${manifestDirectoryPath}.`);
  }

  for (const dependencyName of dependsOn) {
    if (!serviceNames.includes(dependencyName)) {
      errors.push(`services.${serviceName}.dependsOn references an unknown service: ${dependencyName}`);
    }
  }

  if (publicHost !== null) {
    if (!isValidHost(publicHost)) {
      errors.push(`services.${serviceName}.publicHost must be a valid hostname, received: ${publicHost}`);
    }

    if (publicHosts.has(publicHost)) {
      errors.push(`services.${serviceName}.publicHost duplicates another routed service: ${publicHost}`);
    }

    publicHosts.add(publicHost);

    if (port === null) {
      errors.push(`services.${serviceName}.publicHost requires services.${serviceName}.port.`);
    }
  }

  if (ready !== null && "process" in ready && publicHost !== null) {
    errors.push(`services.${serviceName} must not use ready.process on a routed service.`);
  }

  if (port === "auto" && ready !== null) {
    errors.push(`services.${serviceName} must omit ready when port = "auto" in v1.`);
  }

  if (port === null && ready === null) {
    errors.push(`services.${serviceName} must define either port or ready.`);
  }

  if (ready !== null && "http" in ready) {
    validateReadyHttp(serviceName, ready.http, errors);
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
    publicHost,
    ready,
  };
}

function validateReadyHttp(serviceName: string, rawUrl: string, errors: string[]): void {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    errors.push(`services.${serviceName}.ready.http must be an absolute URL, received: ${rawUrl}`);
    return;
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)) {
    errors.push(`services.${serviceName}.ready.http must target 127.0.0.1, localhost, or ::1.`);
  }
}

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "manifest";
  }

  return path.join(".");
}
