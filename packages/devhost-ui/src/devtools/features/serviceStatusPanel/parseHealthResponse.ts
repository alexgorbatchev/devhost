import type {
  HealthResponse,
  IConfigurationStatus,
  IWorktree,
  IWorktreeDirectory,
  ServiceHealth,
  IStoppedService,
  IWorktreeRepository,
} from "../../shared/types";

export function parseHealthResponse(message: string): HealthResponse | null {
  try {
    const value: unknown = JSON.parse(message);
    return isHealthResponse(value) ? value : null;
  } catch {
    return null;
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const services: unknown = Reflect.get(value, "services");
  const repositories: unknown = Reflect.get(value, "repositories");
  const config: unknown = Reflect.get(value, "config");
  const stoppedServices: unknown = Reflect.get(value, "stoppedServices");
  const configuration: unknown = Reflect.get(value, "configuration");
  return (
    Array.isArray(services) &&
    services.every(isServiceHealth) &&
    (stoppedServices === undefined || (Array.isArray(stoppedServices) && stoppedServices.every(isStoppedService))) &&
    (config === undefined || (typeof config === "object" && config !== null && !Array.isArray(config))) &&
    (configuration === undefined || (Array.isArray(configuration) && configuration.every(isConfigurationStatus))) &&
    (repositories === undefined || (Array.isArray(repositories) && repositories.every(isRepository)))
  );
}

function isServiceHealth(value: unknown): value is ServiceHealth {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "managed") === "boolean" &&
    typeof Reflect.get(value, "status") === "boolean" &&
    optional(value, "url", "string") &&
    optional(value, "dirty", "boolean") &&
    optional(value, "restarting", "boolean") &&
    optional(value, "exitCode", "number") &&
    optional(value, "projectRootPath", "string")
  );
}

function isConfigurationStatus(value: unknown): value is IConfigurationStatus {
  if (typeof value !== "object" || value === null) return false;
  const source: unknown = Reflect.get(value, "source");
  return (
    (source === "manifest" || source === "config") &&
    Number.isInteger(Reflect.get(value, "reloads")) &&
    optional(value, "error", "string")
  );
}

function isStoppedService(value: unknown): value is IStoppedService {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "name") === "string";
}

function isRepository(value: unknown): value is IWorktreeRepository {
  if (typeof value !== "object" || value === null) return false;
  const names: unknown = Reflect.get(value, "serviceNames");
  const worktrees: unknown = Reflect.get(value, "worktrees");
  return (
    ["id", "name", "defaultBranch", "configuredPath", "selectedPath", "runningPath"].every(
      (key) => typeof Reflect.get(value, key) === "string",
    ) &&
    typeof Reflect.get(value, "switching") === "boolean" &&
    optional(value, "error", "string") &&
    optional(value, "blockedReason", "string") &&
    Array.isArray(names) &&
    names.every((name: unknown) => typeof name === "string") &&
    Array.isArray(worktrees) &&
    worktrees.every(isWorktree)
  );
}

function isWorktree(value: unknown): value is IWorktree {
  if (typeof value !== "object" || value === null) return false;
  const directories: unknown = Reflect.get(value, "directories");
  return (
    ["path", "branch", "head"].every((key) => typeof Reflect.get(value, key) === "string") &&
    typeof Reflect.get(value, "available") === "boolean" &&
    typeof Reflect.get(value, "detached") === "boolean" &&
    optional(value, "reason", "string") &&
    Array.isArray(directories) &&
    directories.every(isDirectory)
  );
}

function isDirectory(value: unknown): value is IWorktreeDirectory {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "name") === "string" &&
    typeof Reflect.get(value, "cwd") === "string"
  );
}

function optional(value: object, key: string, kind: string): boolean {
  const field: unknown = Reflect.get(value, key);
  return field === undefined || typeof field === kind;
}
