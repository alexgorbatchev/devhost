import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IAnnotationSubmitDetail } from "../devtools/features/annotationComposer/types";

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
  const claudeSettingsFilePath: string = join(sessionDirectoryPath, "claude-settings.json");
  const opencodePluginFilePath: string = join(sessionDirectoryPath, "opencode-plugin.ts");
  const opencodeConfigFilePath: string = join(sessionDirectoryPath, "opencode-config.jsonc");

  const claudeSettings = {
    hooks: {
      SessionStart: [
        { matcher: "", hooks: [{ type: "command", command: "printf '\\x1b]1337;SetAgentStatus=working\\x07'" }] },
      ],
      UserPromptSubmit: [
        { matcher: "", hooks: [{ type: "command", command: "printf '\\x1b]1337;SetAgentStatus=working\\x07'" }] },
      ],
      Stop: [
        { matcher: "", hooks: [{ type: "command", command: "printf '\\x1b]1337;SetAgentStatus=finished\\x07'" }] },
      ],
      SessionEnd: [
        { matcher: "", hooks: [{ type: "command", command: "printf '\\x1b]1337;SetAgentStatus=finished\\x07'" }] },
      ],
    },
  };

  const opencodePlugin = `export default async function() {
  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === 'session.status' && event.properties?.status?.type === 'running') {
        process.stdout.write('\\x1b]1337;SetAgentStatus=working\\x07');
      }
      if (event.type === 'session.idle' || (event.type === 'session.status' && event.properties?.status?.type === 'idle')) {
        process.stdout.write('\\x1b]1337;SetAgentStatus=finished\\x07');
      }
    }
  };
}`;

  const opencodeConfig = {
    plugin: [opencodePluginFilePath],
  };

  writeFileSync(claudeSettingsFilePath, JSON.stringify(claudeSettings, null, 2), "utf8");
  writeFileSync(opencodePluginFilePath, opencodePlugin, "utf8");
  writeFileSync(opencodeConfigFilePath, JSON.stringify(opencodeConfig, null, 2), "utf8");

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
      DEVHOST_AGENT_CLAUDE_SETTINGS_FILE: claudeSettingsFilePath,
      DEVHOST_AGENT_OPENCODE_CONFIG_FILE: opencodeConfigFilePath,
    },
  };
}
