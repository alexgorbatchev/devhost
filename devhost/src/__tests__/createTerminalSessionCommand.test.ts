import { describe, expect, test } from "bun:test";

import { createTerminalSessionCommand } from "../createTerminalSessionCommand";
import { createPiAnnotationPrompt } from "../createPiAnnotationPrompt";
import { createPiTerminalSessionCommand } from "../createPiTerminalSessionCommand";
import type { IAnnotationSubmitDetail } from "../devtools/features/annotationComposer/types";

describe("createTerminalSessionCommand", () => {
  test("builds the Pi terminal command for annotation sessions", () => {
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
          kind: "pi-annotation",
        },
      }),
    ).toEqual(createPiTerminalSessionCommand(createPiAnnotationPrompt(annotation)));
  });

  test("builds the Neovim command for component-source sessions", () => {
    expect(
      createTerminalSessionCommand({
        componentEditor: "neovim",
        projectRootPath: "/tmp/project",
        request: {
          componentName: "PrimaryButton",
          kind: "component-source",
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

  test("rejects component-source sessions when Neovim is not configured", () => {
    expect(() => {
      createTerminalSessionCommand({
        componentEditor: "cursor",
        projectRootPath: "/tmp/project",
        request: {
          componentName: "PrimaryButton",
          kind: "component-source",
          source: {
            fileName: "src/components/PrimaryButton.tsx",
            lineNumber: 42,
          },
          sourceLabel: "src/components/PrimaryButton.tsx:42:1",
        },
      });
    }).toThrow('Component source terminal sessions require devtoolsComponentEditor = "neovim".');
  });
});
