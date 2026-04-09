import { readFileSync } from "node:fs";

import { afterEach, describe, expect, test } from "bun:test";

import { createAnnotationAgentPrompt } from "../createAnnotationAgentPrompt";
import { createTerminalSessionCommand } from "../createTerminalSessionCommand";
import type { IAnnotationSubmitDetail } from "../../devtools/features/annotationComposer/types";
import type { TestCleanupFunction } from "../../utils/__tests__/testTypes";

const cleanupFunctions: Array<TestCleanupFunction> = [];

afterEach(() => {
  for (const cleanup of cleanupFunctions.splice(0)) {
    cleanup();
  }
});

describe("createTerminalSessionCommand", () => {
  test("builds the Claude Code agent terminal command for annotation sessions", () => {
    const annotation: IAnnotationSubmitDetail = {
      comment: "Fix the primary button spacing.",
      markers: [],
      stackName: "hello-stack",
      submittedAt: 1_717_171_717_000,
      title: "Buttons",
      url: "https://hello.test/buttons",
    };

    const terminalSessionCommand = createTerminalSessionCommand({
      agent: {
        displayName: "Claude Code",
        kind: "claude-code",
      },
      componentEditor: "vscode",
      projectRootPath: "/tmp/project",
      request: {
        annotation,
        kind: "agent",
      },
      stackName: "hello-stack",
    });

    cleanupFunctions.push(terminalSessionCommand.cleanup);

    expect(terminalSessionCommand.command[0]).toBe("claude");
    expect(terminalSessionCommand.command[1]).toMatch(
      /^Please read the annotation details from .*prompt\.txt and address the requested change\.$/,
    );
    expect(terminalSessionCommand.env.DEVHOST_AGENT_PROMPT_FILE).toBeDefined();
  });

  test("builds the default Pi agent terminal command for annotation sessions", () => {
    const annotation: IAnnotationSubmitDetail = {
      comment: "Fix the primary button spacing.",
      markers: [],
      stackName: "hello-stack",
      submittedAt: 1_717_171_717_000,
      title: "Buttons",
      url: "https://hello.test/buttons",
    };

    const terminalSessionCommand = createTerminalSessionCommand({
      agent: {
        displayName: "Pi",
        kind: "pi",
      },
      componentEditor: "vscode",
      projectRootPath: "/tmp/project",
      request: {
        annotation,
        kind: "agent",
      },
      stackName: "hello-stack",
    });

    cleanupFunctions.push(terminalSessionCommand.cleanup);

    expect(terminalSessionCommand.command).toEqual(["pi", expect.stringMatching(/^@.*prompt\.txt$/)]);
    expect(terminalSessionCommand.env.DEVHOST_AGENT_PROMPT_FILE).toBeDefined();
    expect(terminalSessionCommand.cwd).toBe("/tmp/project");
  });

  test("builds the OpenCode agent terminal command for annotation sessions", () => {
    const annotation: IAnnotationSubmitDetail = {
      comment: "Fix the primary button spacing.",
      markers: [],
      stackName: "hello-stack",
      submittedAt: 1_717_171_717_000,
      title: "Buttons",
      url: "https://hello.test/buttons",
    };

    const terminalSessionCommand = createTerminalSessionCommand({
      agent: {
        displayName: "OpenCode",
        kind: "opencode",
      },
      componentEditor: "vscode",
      projectRootPath: "/tmp/project",
      request: {
        annotation,
        kind: "agent",
      },
      stackName: "hello-stack",
    });

    cleanupFunctions.push(terminalSessionCommand.cleanup);

    expect(terminalSessionCommand.command[0]).toBe("opencode");
    expect(terminalSessionCommand.command[1]).toMatch(
      /^Please read the annotation details from .*prompt\.txt and address the requested change\.$/,
    );
    expect(terminalSessionCommand.env.DEVHOST_AGENT_PROMPT_FILE).toBeDefined();
  });

  test("builds a configured agent command with temp-file payloads", () => {
    const annotation: IAnnotationSubmitDetail = {
      comment: "Fix the primary button spacing.",
      markers: [],
      stackName: "hello-stack",
      submittedAt: 1_717_171_717_000,
      title: "Buttons",
      url: "https://hello.test/buttons",
    };

    const terminalSessionCommand = createTerminalSessionCommand({
      agent: {
        command: ["bun", "./scripts/devhost-agent.ts"],
        cwd: "/tmp/project",
        displayName: "Claude Code",
        env: {
          DEVHOST_AGENT_MODE: "annotation",
        },
        kind: "configured",
      },
      componentEditor: "vscode",
      projectRootPath: "/tmp/project",
      request: {
        annotation,
        kind: "agent",
      },
      stackName: "hello-stack",
    });

    cleanupFunctions.push(terminalSessionCommand.cleanup);

    expect(terminalSessionCommand.command).toEqual(["bun", "./scripts/devhost-agent.ts"]);
    expect(terminalSessionCommand.cwd).toBe("/tmp/project");
    expect(terminalSessionCommand.env.DEVHOST_AGENT_MODE).toBe("annotation");
    expect(terminalSessionCommand.env.DEVHOST_AGENT_DISPLAY_NAME).toBe("Claude Code");
    expect(terminalSessionCommand.env.DEVHOST_AGENT_TRANSPORT).toBe("files");
    expect(terminalSessionCommand.env.DEVHOST_PROJECT_ROOT).toBe("/tmp/project");
    expect(terminalSessionCommand.env.DEVHOST_STACK_NAME).toBe("hello-stack");
    expect(readFileSync(terminalSessionCommand.env.DEVHOST_AGENT_PROMPT_FILE, "utf8")).toBe(
      createAnnotationAgentPrompt(annotation),
    );
    expect(JSON.parse(readFileSync(terminalSessionCommand.env.DEVHOST_AGENT_ANNOTATION_FILE, "utf8"))).toEqual(
      annotation,
    );
  });

  test("builds the Neovim command for editor sessions", () => {
    expect(
      createTerminalSessionCommand({
        agent: {
          displayName: "Pi",
          kind: "pi",
        },
        componentEditor: "neovim",
        projectRootPath: "/tmp/project",
        request: {
          componentName: "PrimaryButton",
          kind: "editor",
          launcher: "neovim",
          source: {
            columnNumber: 8,
            fileName: "webpack:///./src/components/PrimaryButton.tsx",
            lineNumber: 42,
          },
          sourceLabel: "src/components/PrimaryButton.tsx:42:8",
        },
        stackName: "hello-stack",
      }),
    ).toEqual({
      cleanup: expect.any(Function),
      command: ["nvim", "-c", "call cursor(42, 8)", "--", "/tmp/project/src/components/PrimaryButton.tsx"],
      cwd: "/tmp/project",
      env: {},
    });
  });

  test("rejects editor sessions when Neovim is not configured", () => {
    expect(() => {
      createTerminalSessionCommand({
        agent: {
          displayName: "Pi",
          kind: "pi",
        },
        componentEditor: "cursor",
        projectRootPath: "/tmp/project",
        request: {
          componentName: "PrimaryButton",
          kind: "editor",
          launcher: "neovim",
          source: {
            fileName: "src/components/PrimaryButton.tsx",
            lineNumber: 42,
          },
          sourceLabel: "src/components/PrimaryButton.tsx:42:1",
        },
        stackName: "hello-stack",
      });
    }).toThrow('Editor terminal sessions require devtoolsComponentEditor = "neovim".');
  });
});
