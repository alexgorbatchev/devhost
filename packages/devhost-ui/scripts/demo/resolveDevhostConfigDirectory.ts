import { join } from "node:path";

// Mirrors devhost's own lookup of the directory holding config.toml, so a recording that shares the user's managed
// Caddy also applies the user's shared Caddy settings rather than replacing them.
export function resolveDevhostConfigDirectory(environment: NodeJS.ProcessEnv): string {
  const configured = environment.DEVHOST_CONFIG_DIR?.trim();
  if (configured) return configured;
  const configHome = environment.XDG_CONFIG_HOME?.trim();
  if (configHome) return join(configHome, "devhost");
  const home = environment.HOME?.trim();
  if (!home) throw new Error("Set DEVHOST_CONFIG_DIR, XDG_CONFIG_HOME, or HOME to locate the devhost config file");
  return join(home, ".config", "devhost");
}
