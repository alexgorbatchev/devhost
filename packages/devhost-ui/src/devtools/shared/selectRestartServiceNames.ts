import type { ServiceHealth } from "./types";

/** Keep the restart command and its keyboard shortcut on the same target selection. */
export function selectRestartServiceNames(services: ServiceHealth[], primaryService: string | undefined): string[] {
  if (services.some((service) => service.restarting)) return [];
  const changed = services.filter((service) => service.dirty).map((service) => service.name);
  if (changed.length > 0) return changed;
  return primaryService ? [primaryService] : [];
}
