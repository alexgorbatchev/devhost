import { access, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

interface IStartNvimOptions {
  nvimArguments: string[];
  projectRootPath: string;
  stackName: string | null;
}

interface ILauncherCandidate {
  launcherPath: string;
  stackDirectoryName: string;
}

const launcherRelativePath: string = join("nvim-shell", "bin", "devhost-nvim");

async function startNvim(options: IStartNvimOptions): Promise<number> {
  const launcherPath: string = await resolveLauncherPath(options);
  const nvimProcess = Bun.spawn([launcherPath, ...options.nvimArguments], {
    env: process.env,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return nvimProcess.exited;
}

async function resolveLauncherPath(options: IStartNvimOptions): Promise<string> {
  const candidates: ILauncherCandidate[] = await collectLauncherCandidates(options.projectRootPath);

  if (options.stackName !== null) {
    const expectedStackDirectoryName: string = sanitizeStackDirectoryName(options.stackName);
    const matchingCandidate = candidates.find(
      (candidate) => candidate.stackDirectoryName === expectedStackDirectoryName,
    );

    if (matchingCandidate === undefined) {
      throw new Error(
        `No devhost Neovim launcher exists for stack ${options.stackName} in ${options.projectRootPath}.\n` +
          "Start the devhost stack for that project first.",
      );
    }

    return matchingCandidate.launcherPath;
  }

  if (candidates.length === 0) {
    throw new Error(
      `No devhost Neovim launcher exists under ${options.projectRootPath}/.tmp/devhost.\n` +
        "Start the devhost stack for that project first.",
    );
  }

  if (candidates.length > 1) {
    throw new Error(
      `Multiple devhost Neovim launchers exist under ${options.projectRootPath}/.tmp/devhost: ` +
        `${candidates.map((candidate) => candidate.stackDirectoryName).join(", ")}.\n` +
        "Select one with: bun run nvim -- --stack=<stack-name>",
    );
  }

  const candidate = candidates[0];
  if (candidate === undefined) {
    throw new Error("No devhost Neovim launcher was resolved.");
  }

  return candidate.launcherPath;
}

async function collectLauncherCandidates(projectRootPath: string): Promise<ILauncherCandidate[]> {
  const devhostDirectoryPath: string = join(projectRootPath, ".tmp", "devhost");
  let stackDirectoryNames: string[];

  try {
    stackDirectoryNames = await readdir(devhostDirectoryPath);
  } catch {
    return [];
  }

  const candidates: ILauncherCandidate[] = [];
  for (const stackDirectoryName of stackDirectoryNames) {
    const launcherPath: string = join(devhostDirectoryPath, stackDirectoryName, launcherRelativePath);

    if (await doesFileExist(launcherPath)) {
      candidates.push({ launcherPath, stackDirectoryName });
    }
  }

  return candidates;
}

function parseStartNvimArguments(
  rawArguments: string[],
  environment: NodeJS.ProcessEnv,
  cwd: string,
): IStartNvimOptions {
  let projectRootPath: string = environment.DEVHOST_PROJECT_ROOT ?? cwd;
  let stackName: string | null = environment.DEVHOST_STACK_NAME ?? null;
  const nvimArguments: string[] = [];

  for (const rawArgument of rawArguments) {
    if (rawArgument === "--help") {
      printHelp();
      process.exit(0);
    }

    if (rawArgument.startsWith("--project=")) {
      projectRootPath = rawArgument.slice("--project=".length);
      continue;
    }

    if (rawArgument.startsWith("--stack=")) {
      stackName = rawArgument.slice("--stack=".length);
      continue;
    }

    nvimArguments.push(rawArgument);
  }

  return {
    nvimArguments,
    projectRootPath: resolveProjectRootPath(projectRootPath, cwd),
    stackName,
  };
}

function resolveProjectRootPath(rawProjectRootPath: string, cwd: string): string {
  return isAbsolute(rawProjectRootPath) ? rawProjectRootPath : resolve(cwd, rawProjectRootPath);
}

function sanitizeStackDirectoryName(value: string): string {
  const trimmedValue: string = value.trim();

  if (trimmedValue.length === 0) {
    return "default";
  }

  let sanitizedValue: string = "";
  for (const character of trimmedValue) {
    const isLowercaseLetter: boolean = character >= "a" && character <= "z";
    const isUppercaseLetter: boolean = character >= "A" && character <= "Z";
    const isNumber: boolean = character >= "0" && character <= "9";

    sanitizedValue +=
      isLowercaseLetter || isUppercaseLetter || isNumber || character === "-" || character === "_" ? character : "-";
  }

  const trimmedSanitizedValue: string = sanitizedValue.replace(/^-+|-+$/g, "");
  return trimmedSanitizedValue.length === 0 ? "default" : trimmedSanitizedValue;
}

async function doesFileExist(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function printHelp(): void {
  console.log(`Usage: bun run nvim -- [--project=<path>] [--stack=<name>] [nvim args...]`);
  console.log("");
  console.log("Launches the devhost-generated Neovim wrapper for a running stack.");
}

if (import.meta.main) {
  try {
    const options: IStartNvimOptions = parseStartNvimArguments(Bun.argv.slice(2), process.env, process.cwd());
    process.exit(await startNvim(options));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
