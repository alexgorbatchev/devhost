import type {
  HealthResponse,
  IWorktree,
  IWorktreeDirectory,
  ServiceHealth,
  IWorktreeRepository,
  IRoutingConfig,
} from "../../shared/types";
import type { IRoutedServiceIdentity } from "../../shared/routedServices";

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
  const routing: unknown = Reflect.get(value, "routing");
  return (
    Array.isArray(services) &&
    services.every(isServiceHealth) &&
    (routing === undefined || isRoutingConfig(routing)) &&
    (repositories === undefined || (Array.isArray(repositories) && repositories.every(isRepository)))
  );
}

function isRoutingConfig(value: unknown): value is IRoutingConfig {
  if (typeof value !== "object" || value === null) return false;
  const routes: unknown = Reflect.get(value, "routedServices");
  return (
    typeof Reflect.get(value, "primaryService") === "string" && Array.isArray(routes) && routes.every(isRoutedService)
  );
}

function isRoutedService(value: unknown): value is IRoutedServiceIdentity {
  return (
    typeof value === "object" &&
    value !== null &&
    ["host", "path", "serviceName"].every((key) => typeof Reflect.get(value, key) === "string")
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

function isRepository(value: unknown): value is IWorktreeRepository {
  if (typeof value !== "object" || value === null) return false;
  const names: unknown = Reflect.get(value, "serviceNames");
  const worktrees: unknown = Reflect.get(value, "worktrees");
  return (
    ["id", "name", "configuredPath", "selectedPath", "runningPath"].every(
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
