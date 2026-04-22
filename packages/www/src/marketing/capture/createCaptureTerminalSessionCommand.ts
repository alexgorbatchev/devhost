import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  IAnnotationMarkerPayload,
  IAnnotationSubmitDetail,
  ISourceLocation,
  StartTerminalSessionRequest,
} from "../../devtoolsContracts/types";

interface ICaptureTerminalSessionCommand {
  cleanup: () => void;
  command: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface ICaptureTerminalAgent {
  displayName: string;
  kind: "opencode";
}

interface ICreateCaptureTerminalSessionCommandOptions {
  agent: ICaptureTerminalAgent;
  projectRootPath: string;
  request: StartTerminalSessionRequest;
  stackName: string;
}

const sessionDirectoryPrefix: string = "devhost-agent-session-";

export function createCaptureTerminalSessionCommand(
  options: ICreateCaptureTerminalSessionCommandOptions,
): ICaptureTerminalSessionCommand {
  if (options.request.kind === "editor") {
    return {
      cleanup: (): void => {},
      command: createNeovimSessionCommand(options.request.source, options.projectRootPath),
      cwd: options.projectRootPath,
      env: {},
    };
  }

  const prompt: string = createAnnotationAgentPrompt(options.request.annotation);
  const sessionFiles = createCaptureAgentSessionFiles({
    annotation: options.request.annotation,
    displayName: options.agent.displayName,
    projectRootPath: options.projectRootPath,
    prompt,
    stackName: options.stackName,
  });

  return {
    cleanup: sessionFiles.cleanup,
    command: createOpenCodeAgentCommand(sessionFiles.promptFilePath),
    cwd: options.projectRootPath,
    env: {
      ...sessionFiles.env,
      OPENCODE_CONFIG: sessionFiles.opencodeConfigFilePath,
    },
  };
}

function createCaptureAgentSessionFiles(options: {
  annotation: IAnnotationSubmitDetail;
  displayName: string;
  projectRootPath: string;
  prompt: string;
  stackName: string;
}): {
  cleanup: () => void;
  env: Record<string, string>;
  opencodeConfigFilePath: string;
  promptFilePath: string;
} {
  const temporaryRootPath: string = path.join(options.projectRootPath, ".tmp");
  mkdirSync(temporaryRootPath, { recursive: true });

  const sessionDirectoryPath: string = mkdtempSync(path.join(temporaryRootPath, sessionDirectoryPrefix));
  const annotationFilePath: string = path.join(sessionDirectoryPath, "annotation.json");
  const promptFilePath: string = path.join(sessionDirectoryPath, "prompt.txt");
  const opencodePluginFilePath: string = path.join(sessionDirectoryPath, "opencode-plugin.ts");
  const opencodeConfigFilePath: string = path.join(sessionDirectoryPath, "opencode-config.jsonc");

  writeFileSync(annotationFilePath, JSON.stringify(options.annotation, null, 2), "utf8");
  writeFileSync(promptFilePath, options.prompt, "utf8");
  writeFileSync(opencodePluginFilePath, createOpenCodeStatusPluginSource(), "utf8");
  writeFileSync(opencodeConfigFilePath, JSON.stringify({ plugin: [opencodePluginFilePath] }, null, 2), "utf8");

  return {
    cleanup: (): void => {
      rmSync(sessionDirectoryPath, { force: true, recursive: true });
    },
    env: {
      DEVHOST_AGENT_ANNOTATION_FILE: annotationFilePath,
      DEVHOST_AGENT_DISPLAY_NAME: options.displayName,
      DEVHOST_AGENT_PROMPT_FILE: promptFilePath,
      DEVHOST_AGENT_TRANSPORT: "files",
      DEVHOST_PROJECT_ROOT: options.projectRootPath,
      DEVHOST_STACK_NAME: options.stackName,
    },
    opencodeConfigFilePath,
    promptFilePath,
  };
}

function createOpenCodeStatusPluginSource(): string {
  return [
    "export default async function() {",
    "  return {",
    "    event: async ({ event }) => {",
    "      if (event.type === 'session.status' && event.properties?.status?.type === 'running') {",
    "        process.stdout.write('\\x1b]1337;SetAgentStatus=working\\x07');",
    "      }",
    "      if (event.type === 'session.idle' || (event.type === 'session.status' && event.properties?.status?.type === 'idle')) {",
    "        process.stdout.write('\\x1b]1337;SetAgentStatus=finished\\x07');",
    "      }",
    "    }",
    "  };",
    "}",
  ].join("\n");
}

function createOpenCodeAgentCommand(promptFilePath: string): string[] {
  return [
    "opencode",
    "run",
    `Please read the annotation details from ${promptFilePath} and address the requested change.`,
  ];
}

function createNeovimSessionCommand(source: ISourceLocation, projectRootPath: string): string[] {
  const sourcePath: string = resolveSourceFilePath(source.fileName, projectRootPath);
  const columnNumber: number = source.columnNumber ?? 1;

  return ["nvim", "-c", `call cursor(${source.lineNumber}, ${columnNumber})`, "--", sourcePath];
}

function resolveSourceFilePath(rawFileName: string, projectRootPath: string): string {
  const normalizedSourcePath: string = normalizeFilePath(cleanSourcePath(rawFileName));

  if (isAbsoluteFilePath(normalizedSourcePath)) {
    return normalizedSourcePath;
  }

  if (projectRootPath.length === 0) {
    return normalizedSourcePath;
  }

  return joinFilePaths(projectRootPath, normalizedSourcePath);
}

function cleanSourcePath(rawPath: string): string {
  return rawPath
    .replace(/[?#].*$/, "")
    .replace(/^turbopack:\/\/\/\[project\]\//, "")
    .replace(/^webpack-internal:\/\/\/\.\//, "")
    .replace(/^webpack-internal:\/\/\//, "")
    .replace(/^webpack:\/\/\/\.\//, "")
    .replace(/^webpack:\/\/\//, "")
    .replace(/^turbopack:\/\/\//, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^file:\/\/\//, "/")
    .replace(/^\([^)]+\)\/\.\//, "")
    .replace(/^\.\//, "");
}

function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function isAbsoluteFilePath(filePath: string): boolean {
  return filePath.startsWith("/") || isWindowsDrivePath(filePath) || filePath.startsWith("//");
}

function isWindowsDrivePath(filePath: string): boolean {
  return /^[A-Za-z]:\//.test(filePath);
}

function joinFilePaths(basePath: string, relativePath: string): string {
  const normalizedBasePath: string = normalizeFilePath(basePath).replace(/\/+$/, "");
  const normalizedRelativePath: string = normalizeFilePath(relativePath);
  const baseHasLeadingSlash: boolean = normalizedBasePath.startsWith("/");
  const baseSegments: string[] = normalizedBasePath.split("/").filter((segment: string): boolean => {
    return segment.length > 0;
  });
  const relativeSegments: string[] = normalizedRelativePath.split("/");
  const joinedSegments: string[] = [...baseSegments];

  for (const segment of relativeSegments) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const canPopSegment: boolean =
        joinedSegments.length > 1 || (joinedSegments.length === 1 && !isWindowsDrivePath(joinedSegments[0]!));

      if (canPopSegment) {
        joinedSegments.pop();
      }

      continue;
    }

    joinedSegments.push(segment);
  }

  const joinedPath: string = joinedSegments.join("/");

  return baseHasLeadingSlash ? `/${joinedPath}` : joinedPath;
}

function createAnnotationAgentPrompt(annotation: IAnnotationSubmitDetail): string {
  const markerSections: string = annotation.markers.map(renderMarkerSection).join("\n\n");

  return [
    "You are responding to a browser annotation captured by devhost.",
    "Use the annotation context below to inspect the local codebase and drive the requested change.",
    "",
    "## Requested change",
    annotation.comment,
    "",
    "## Page context",
    `- Stack: ${annotation.stackName}`,
    `- URL: ${annotation.url}`,
    `- Title: ${annotation.title}`,
    `- Submitted at: ${new Date(annotation.submittedAt).toISOString()}`,
    "",
    "## Annotated markers",
    markerSections,
    "",
    "## Required behavior",
    "- Inspect the local codebase before proposing changes.",
    "- Use the marker references (#1, #2, ...) when reasoning about the requested UI or behavior.",
    "- If the request is ambiguous, ask clarifying questions before making irreversible changes.",
    "- Prefer correct, durable fixes over quick workarounds.",
  ].join("\n");
}

function renderMarkerSection(marker: IAnnotationMarkerPayload): string {
  return [
    `### Marker #${marker.markerNumber}`,
    `- Full path: ${marker.fullPath}`,
    `- Accessibility: ${marker.accessibility || "(none)"}`,
    `- Nearby text: ${marker.nearbyText || "(none)"}`,
    `- Nearby elements: ${marker.nearbyElements || "(none)"}`,
    `- Selected text: ${marker.selectedText ?? "(none)"}`,
    `- Source location: ${formatAnnotationSourceLocation(marker)}`,
    `- Fixed positioned: ${marker.isFixed ? "yes" : "no"}`,
    `- Bounding box: x=${marker.boundingBox.x}, y=${marker.boundingBox.y}, width=${marker.boundingBox.width}, height=${marker.boundingBox.height}`,
    "- Computed styles:",
    marker.computedStyles,
  ].join("\n");
}

function formatAnnotationSourceLocation(marker: IAnnotationMarkerPayload): string {
  const sourceLocation = marker.sourceLocation;

  if (sourceLocation === undefined) {
    return "(not available)";
  }

  const columnSuffix: string = sourceLocation.columnNumber === undefined ? "" : `:${sourceLocation.columnNumber}`;
  const componentPrefix: string =
    sourceLocation.componentName === undefined ? "" : `${sourceLocation.componentName} @ `;

  return `${componentPrefix}${sourceLocation.fileName}:${sourceLocation.lineNumber}${columnSuffix}`;
}
