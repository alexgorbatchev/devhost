import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChatSettings } from "../ChatSettings";
import {
  PageChatScene,
  ShadowPageChatScene,
  chooseChatSetting,
  installPageChatCatalog,
  installUnavailableHarnessCatalog,
} from "./helpers";
import { readDevtoolsStoryShadowCanvas } from "../../../../shared/components/stories/helpers";
import { userEvent as nativeUserEvent } from "vitest/browser";
const meta: Meta<typeof ChatSettings> = {
  component: ChatSettings,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatSettings",
  render: () => <PageChatScene />,
  beforeEach: installPageChatCatalog,
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    expect(canvas.queryByRole("combobox", { name: "Harness" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    const dialog = await canvas.findByRole("dialog", { name: "Chat Settings" });
    await waitFor(() => expect(dialog).toBeVisible());
    const model = within(dialog).getByRole("combobox", { name: "Model" });
    await waitFor(() => expect(model).toHaveTextContent("Configured default"));
    await chooseChatSetting(canvas, "Model", "Discovered Codex model");
    expect(model).toHaveTextContent("Discovered Codex model");
    expect(model.getBoundingClientRect().height).toBeGreaterThanOrEqual(28);
    // The trigger spans the dialog's field column instead of shrinking to its label.
    expect(model.getBoundingClientRect().width).toBe(
      within(dialog).getByRole("combobox", { name: "Harness" }).getBoundingClientRect().width,
    );
    await chooseChatSetting(canvas, "Model", "Configured default");
    expect(model).toHaveTextContent("Configured default");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Chat Settings" })).toHaveFocus());
  },
};
export const InjectedSettingsReceivePointerInput: Story = {
  render: () => <ShadowPageChatScene />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const counter = canvas.getByRole("button", { name: "Page counter: 0" });
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await nativeUserEvent.click(shadowCanvas.getByRole("button", { name: "Chat Settings" }));
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Chat Settings" });
    const model = within(dialog).getByRole("combobox", { name: "Model" });
    const root = model.getRootNode();
    expect(root).toBeInstanceOf(ShadowRoot);
    const rectangle = model.getBoundingClientRect();
    await waitFor(() =>
      expect(
        model.contains(
          (root as ShadowRoot).elementFromPoint(
            rectangle.left + rectangle.width / 2,
            rectangle.top + rectangle.height / 2,
          ),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(model).toBeEnabled());
    await nativeUserEvent.click(model);
    // The list renders in the devtools shadow root, where the page's pointer input reaches it.
    const option = await shadowCanvas.findByRole("option", { name: "Discovered Codex model" });
    expect(option.getRootNode()).toBe(root);
    await nativeUserEvent.click(option);
    await waitFor(() => expect(model).toHaveTextContent("Discovered Codex model"));
    expect(counter).toHaveTextContent("Page counter: 0");
    await nativeUserEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(shadowCanvas.queryByRole("dialog", { name: "Chat Settings" })).toBeNull());
    await nativeUserEvent.click(shadowCanvas.getByRole("button", { name: "Chat Settings" }));
    await shadowCanvas.findByRole("dialog", { name: "Chat Settings" });
    const backdrop = (root as ShadowRoot).elementFromPoint(4, 4);
    expect(backdrop).toHaveAttribute("data-slot", "dialog-overlay");
    await nativeUserEvent.click(backdrop as HTMLElement, { position: { x: 4, y: 4 } });
    await waitFor(() => expect(shadowCanvas.queryByRole("dialog", { name: "Chat Settings" })).toBeNull());
    expect(counter).toHaveTextContent("Page counter: 0");
    await nativeUserEvent.click(counter);
    expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
  },
};

export const UnavailableHarnessIsOfferedDisabled: Story = {
  beforeEach: installUnavailableHarnessCatalog,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    const harness = await canvas.findByRole("combobox", { name: "Harness" });
    await waitFor(() => expect(harness).toHaveTextContent("Codex"));
    await userEvent.click(harness);
    const listbox = await canvas.findByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "Codex" })).not.toHaveAttribute("aria-disabled", "true");
    expect(within(listbox).getByRole("option", { name: "Claude Code (unavailable)" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.queryByRole("listbox")).toBeNull());
    expect(harness).toHaveTextContent("Codex");
  },
};
