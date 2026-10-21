import { act, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";

import { readDevtoolsStoryShadowCanvas } from "../../../shared/components/stories/helpers";
import { isEventTargetEditingSurface } from "../../../shared/isEventTargetEditingSurface";
import { createConfigEditorClient, manifestFile, renderConfigEditorPanel } from "./helpers";

const keyTargets: boolean[] = [];
const recordKeyTarget = (event: KeyboardEvent): void => {
  keyTargets.push(isEventTargetEditingSurface(event.composedPath().at(0) ?? event.target));
};

afterEach(() => {
  document.removeEventListener("keydown", recordKeyTarget, true);
  keyTargets.length = 0;
});

describe("ConfigEditorPanel", () => {
  test("saves with the platform's save shortcut while devhost's own shortcuts see an editing surface", async () => {
    const client = createConfigEditorClient();
    const view = renderConfigEditorPanel(client);

    // The panel loads its files as it opens.
    await act(async (): Promise<void> => {});
    const canvas = await readDevtoolsStoryShadowCanvas(view.container);
    const editor: HTMLElement = await canvas.findByRole("textbox", { name: "Configuration file" });

    await waitFor(() => expect(editor).toHaveTextContent('name = "shop"'));
    document.addEventListener("keydown", recordKeyTarget, true);

    // Real input reaches the editor inside the shadow root, unlike synthetic events.
    await act(async () => userEvent.click(within(editor).getByText('"shop"')));
    await act(async () => userEvent.keyboard("{End}{Enter}# saved"));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Save" })).toBeEnabled());
    await act(async () => userEvent.keyboard("{ControlOrMeta>}s{/ControlOrMeta}"));

    await waitFor(() =>
      expect(client.save.mock.calls).toEqual([[manifestFile.path, 'name = "shop"\n# saved\n', manifestFile.version]]),
    );
    expect(keyTargets.length).toBeGreaterThan(0);
    expect(keyTargets.every((isEditingSurface: boolean): boolean => isEditingSurface)).toBe(true);
  });
});
