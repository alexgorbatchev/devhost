import { fn } from "storybook/test";

import type { IConfigurationStatus } from "../../../../shared/types";
import type { IConfigEditorClient, IConfigEditorSchema, IConfigFile, IConfigIssue } from "../../types";

export const fixture_manifestFile: IConfigFile = {
  content: [
    'name = "shop"',
    'includes = ["packages/*/devhost.toml"]',
    "",
    "[devtools.status]",
    'position = "top-right"',
    "",
  ].join("\n"),
  kind: "manifest",
  path: "/home/alex/shop/devhost.toml",
  version: "manifest-1",
};

export const fixture_includeFile: IConfigFile = {
  content: ["[services.api]", 'command = ["bun", "run", "dev"]', "port = 4000", ""].join("\n"),
  kind: "include",
  path: "/home/alex/shop/packages/api/devhost.toml",
  version: "include-1",
};

export const fixture_sharedConfigFile: IConfigFile = {
  content: "",
  kind: "config",
  path: "/home/alex/.config/devhost/config.toml",
  version: "",
};

export const fixture_configFiles: IConfigFile[] = [fixture_manifestFile, fixture_includeFile, fixture_sharedConfigFile];

export const fixture_configEditorSchema: IConfigEditorSchema = {
  config: {
    tables: { "": ["caddy"], caddy: ["adminAddress", "bindHost", "http", "httpPort", "httpsPort"] },
    values: { "caddy.bindHost": ["127.0.0.1", "0.0.0.0", "::1", "::"] },
  },
  manifest: {
    tables: {
      "": ["devtools", "includes", "name", "services"],
      devtools: ["configEditor", "status"],
      "devtools.configEditor": ["enabled"],
      "devtools.status": ["enabled", "position"],
      "services.*": ["command", "cwd", "port"],
    },
    values: { "devtools.status.position": ["top-right", "bottom-right"] },
  },
};

export const fixture_acceptedConfiguration: IConfigurationStatus[] = [
  { reloads: 1, source: "config" },
  { reloads: 1, source: "manifest" },
];

export const fixture_rejectedConfiguration: IConfigurationStatus[] = [
  { reloads: 1, source: "config" },
  {
    error: 'Failed to parse /home/alex/shop/devhost.toml: toml: line 4 (last key "position"): expected value',
    reloads: 2,
    source: "manifest",
  },
];

export const fixture_portIssue: IConfigIssue = {
  keyPath: "services.api.port",
  message: 'services.api.port must be an integer between 1 and 65535 or "auto".',
};

/**
 * A client for devhost's config routes that keeps its files in memory. Its check reports a port of 0, as devhost
 * does; a save writes the file and answers with the next version.
 */
export function factory_configEditorClient(): IConfigEditorClient {
  const files: Map<string, IConfigFile> = new Map(fixture_configFiles.map((file) => [file.path, file]));
  let savedVersions: number = 0;

  return {
    check: fn(async (_path: string, content: string) => ({
      issues: /^port = 0$/m.test(content) ? [fixture_portIssue] : [],
    })),
    listFiles: fn(async () => ({ files: [...files.values()] })),
    readSchema: fn(async () => ({ schema: fixture_configEditorSchema })),
    save: fn(async (path: string, content: string) => {
      const file: IConfigFile | undefined = files.get(path);

      savedVersions += 1;
      files.set(path, { kind: file?.kind ?? "manifest", path, content, version: `saved-${savedVersions}` });

      return { kind: "saved" as const, version: `saved-${savedVersions}` };
    }),
  };
}
