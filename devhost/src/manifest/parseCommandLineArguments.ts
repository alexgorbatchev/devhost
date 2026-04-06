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
  if (rawArguments[0] === "caddy") {
    return parseCaddyCommandLineArguments(rawArguments.slice(1));
  }

  const manifestIndex: number = rawArguments.indexOf("--manifest");

  if (manifestIndex !== -1) {
    const manifestPath: string = readRequiredOption(rawArguments, "--manifest");

    if (!manifestPath.endsWith("devhost.toml")) {
      throw new Error(`--manifest must point to a file named devhost.toml, received: ${manifestPath}`);
    }

    if (rawArguments.includes("--")) {
      throw new Error("Manifest mode does not accept a child command.");
    }

    return {
      kind: "manifest",
      manifestPath,
    };
  }

  return {
    kind: "manifest",
    manifestPath: null,
  };
}

function parseCaddyCommandLineArguments(rawArguments: string[]): ICaddyCommandLineArguments {
  const action: string | undefined = rawArguments[0];

  if (action === undefined) {
    throw new Error("Expected a caddy action: start, stop, trust, or download.");
  }

  if (rawArguments.length !== 1) {
    throw new Error("Caddy commands do not accept additional arguments.");
  }

  if (action !== "start" && action !== "stop" && action !== "trust" && action !== "download") {
    throw new Error(`Unsupported caddy action: ${action}`);
  }

  return {
    action,
    kind: "caddy",
  };
}

function readRequiredOption(optionArguments: string[], optionName: string): string {
  const optionIndex: number = optionArguments.indexOf(optionName);

  if (optionIndex === -1) {
    throw new Error(`Missing required option: ${optionName}`);
  }

  const optionValue: string | undefined = optionArguments[optionIndex + 1];

  if (optionValue === undefined || optionValue.startsWith("--")) {
    throw new Error(`Missing value for ${optionName}`);
  }

  return optionValue;
}
