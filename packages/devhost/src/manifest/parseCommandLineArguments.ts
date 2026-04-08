import { parseArgs } from "util";

export type CommandLineArguments = ICaddyCommandLineArguments | IManifestCommandLineArguments;

export interface ICaddyCommandLineArguments {
  kind: "caddy";
  action: "start" | "stop" | "trust" | "download";
}

export interface IManifestCommandLineArguments {
  kind: "manifest";
  manifestPath: string | null;
}

export function parseCommandLineArguments(rawArguments: string[]): CommandLineArguments {
  let parsed;
  try {
    parsed = parseArgs({
      args: rawArguments,
      options: {
        manifest: {
          type: "string",
        },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }

  const { values, positionals } = parsed;

  const isCaddyCommand = positionals[0] === "caddy";

  if (isCaddyCommand) {
    if (positionals.length === 1) {
      throw new Error("Expected a caddy action: start, stop, trust, or download.");
    }
    if (positionals.length > 2) {
      throw new Error("Caddy commands do not accept additional arguments.");
    }

    const action = positionals[1];

    if (action !== "start" && action !== "stop" && action !== "trust" && action !== "download") {
      throw new Error(`Unsupported caddy action: ${action}`);
    }

    return {
      kind: "caddy",
      action: action as ICaddyCommandLineArguments["action"],
    };
  }

  if (values.manifest) {
    if (!values.manifest.endsWith("devhost.toml")) {
      throw new Error(`--manifest must point to a file named devhost.toml, received: ${values.manifest}`);
    }

    if (positionals.length > 0) {
      throw new Error("Manifest mode does not accept a child command.");
    }

    return {
      kind: "manifest",
      manifestPath: values.manifest,
    };
  }

  return {
    kind: "manifest",
    manifestPath: null,
  };
}
