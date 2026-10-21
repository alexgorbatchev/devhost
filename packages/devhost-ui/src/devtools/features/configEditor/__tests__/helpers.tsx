import { render, type RenderResult } from "@testing-library/react";
import { vi } from "vitest";

import { renderInDevtoolsStoryShadowRoot } from "../../../shared/components/stories/helpers";
import type { ConfigSaveResult, IConfigEditorClient, IConfigFile } from "../types";
import { ConfigEditorPanel } from "../components/ConfigEditorPanel";

export const manifestFile: IConfigFile = {
  content: 'name = "shop"\n',
  kind: "manifest",
  path: "/home/alex/shop/devhost.toml",
  version: "manifest-1",
};

export function createConfigEditorClient() {
  return {
    check: vi.fn<IConfigEditorClient["check"]>(async () => ({ issues: [] })),
    listFiles: vi.fn<IConfigEditorClient["listFiles"]>(async () => ({ files: [manifestFile] })),
    readSchema: vi.fn<IConfigEditorClient["readSchema"]>(async () => ({
      schema: { config: { tables: {}, values: {} }, manifest: { tables: { "": ["name"] }, values: {} } },
    })),
    save: vi.fn<IConfigEditorClient["save"]>(async (): Promise<ConfigSaveResult> => ({ kind: "saved", version: "2" })),
  };
}

/** Renders an open config editor in a devtools shadow root, as the page shows it. */
export function renderConfigEditorPanel(client: IConfigEditorClient): RenderResult {
  return render(
    renderInDevtoolsStoryShadowRoot(
      <ConfigEditorPanel
        client={client}
        configuration={[]}
        homeDirectoryPath="/home/alex"
        isOpen
        projectRootPath="/home/alex/shop"
        onClose={vi.fn()}
      />,
    ),
  );
}
