import type { IConfigSchema } from "../types";

export const fixture_manifestSchema: IConfigSchema = {
  tables: {
    "": ["annotation", "devtools", "groups", "includes", "name", "services"],
    annotation: ["actions", "agent"],
    "annotation.actions.*": ["command", "id", "kind", "label"],
    "annotation.actions.*.command": ["command", "cwd"],
    devtools: ["configEditor", "status"],
    "devtools.configEditor": ["enabled"],
    "devtools.status": ["enabled", "position"],
    "services.*": ["command", "health", "lifecycle", "port"],
    "services.*.health": ["http", "tcp"],
    "services.*.lifecycle": ["mode", "start"],
  },
  values: {
    "annotation.actions.*.kind": ["agent", "command"],
    "devtools.status.position": ["top-right", "bottom-right"],
    "services.*.lifecycle.mode": ["foreground", "daemon"],
  },
};
