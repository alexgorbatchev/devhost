import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IAnnotationSubmitDetail } from "./devtools/features/annotationComposer/types";

interface ICreateAgentSessionFilesOptions {
  annotation: IAnnotationSubmitDetail;
  displayName: string;
  projectRootPath: string;
  prompt: string;
  stackName: string;
}

interface IAgentSessionFiles {
  cleanup: () => void;
  env: Record<string, string>;
}

const agentTransportMode: string = "files";
const sessionDirectoryPrefix: string = join(tmpdir(), "devhost-agent-session-");

export function createAgentSessionFiles(options: ICreateAgentSessionFilesOptions): IAgentSessionFiles {
  const sessionDirectoryPath: string = mkdtempSync(sessionDirectoryPrefix);
  const annotationFilePath: string = join(sessionDirectoryPath, "annotation.json");
  const promptFilePath: string = join(sessionDirectoryPath, "prompt.txt");

  writeFileSync(annotationFilePath, JSON.stringify(options.annotation, null, 2), "utf8");
  writeFileSync(promptFilePath, options.prompt, "utf8");

  return {
    cleanup: (): void => {
      rmSync(sessionDirectoryPath, { force: true, recursive: true });
    },
    env: {
      DEVHOST_AGENT_ANNOTATION_FILE: annotationFilePath,
      DEVHOST_AGENT_DISPLAY_NAME: options.displayName,
      DEVHOST_AGENT_PROMPT_FILE: promptFilePath,
      DEVHOST_AGENT_TRANSPORT: agentTransportMode,
      DEVHOST_PROJECT_ROOT: options.projectRootPath,
      DEVHOST_STACK_NAME: options.stackName,
    },
  };
}
