import { isValidHost } from "../utils/isValidHost";

export type CommandLineArguments =
  | ICaddyCommandLineArguments
  | ISingleServiceCommandLineArguments
  | IManifestCommandLineArguments;

export interface ICaddyCommandLineArguments {
  kind: "caddy";
  action: "start" | "stop" | "trust" | "download";
}

export interface ISingleServiceCommandLineArguments {
  kind: "single-service";
  host: string;
  port: number;
  command: string[];
}

export interface IManifestCommandLineArguments {
  kind: "manifest";
  manifestPath: string | null;
}

export function parseCommandLineArguments(rawArguments: string[]): CommandLineArguments {
  if (rawArguments[0] === "caddy") {
    return parseCaddyCommandLineArguments(rawArguments.slice(1));
  }

  const hostIndex: number = rawArguments.indexOf("--host");
  const manifestIndex: number = rawArguments.indexOf("--manifest");

  if (hostIndex !== -1 && manifestIndex !== -1) {
    throw new Error("--manifest and --host are mutually exclusive.");
  }

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

  if (hostIndex === -1) {
    if (rawArguments.includes("--port")) {
      throw new Error("--port requires --host.");
    }

    if (rawArguments.includes("--")) {
      throw new Error("Single-service mode requires --host and --port.");
    }

    return {
      kind: "manifest",
      manifestPath: null,
    };
  }

  const separatorIndex: number = rawArguments.indexOf("--");

  if (separatorIndex === -1) {
    throw new Error("Expected '--' before the child command.");
  }

  const optionArguments: string[] = rawArguments.slice(0, separatorIndex);
  const command: string[] = rawArguments.slice(separatorIndex + 1);

  if (command.length === 0) {
    throw new Error("Expected a child command after '--'.");
  }

  const host: string = readRequiredOption(optionArguments, "--host").trim().toLowerCase();
  const portText: string = readRequiredOption(optionArguments, "--port").trim();
  const port: number = Number.parseInt(portText, 10);

  if (!isValidHost(host)) {
    throw new Error(`Host must be a valid hostname, received: ${host}`);
  }

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Port must be a valid TCP port, received: ${portText}`);
  }

  return {
    command,
    host,
    kind: "single-service",
    port,
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
