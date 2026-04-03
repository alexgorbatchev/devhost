import { describe, expect, test } from "bun:test";

import { createAnnotationAgentPrompt } from "../createAnnotationAgentPrompt";
import { createPiAgentCommand } from "../createPiAgentCommand";
import { createTerminalSessionCommand } from "../createTerminalSessionCommand";
import type { IAnnotationSubmitDetail } from "../devtools/features/annotationComposer/types";

describe("createTerminalSessionCommand", () => {
  test("builds the agent terminal command for annotation sessions", () => {
    const annotation: IAnnotationSubmitDetail = {
      comment: "Fix the primary button spacing.",
      markers: [],
      stackName: "hello-stack",
      submittedAt: 1_717_171_717_000,
      title: "Buttons",
      url: "https://hello.test/buttons",
    };

    expect(
      createTerminalSessionCommand({
        componentEditor: "vscode",
        projectRootPath: "/tmp/project",
        request: {
          annotation,
          kind: "agent",
          launcher: "pi",
        },
      }),
    ).toEqual(createPiAgentCommand(createAnnotationAgentPrompt(annotation)));
  });

  test("builds the Neovim command for editor sessions", () => {
    expect(
      createTerminalSessionCommand({
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
      }),
    ).toEqual(["nvim", "-c", "call cursor(42, 8)", "--", "/tmp/project/src/components/PrimaryButton.tsx"]);
  });

  test("rejects editor sessions when Neovim is not configured", () => {
    expect(() => {
      createTerminalSessionCommand({
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
      });
    }).toThrow('Editor terminal sessions require devtoolsComponentEditor = "neovim".');
  });
});
