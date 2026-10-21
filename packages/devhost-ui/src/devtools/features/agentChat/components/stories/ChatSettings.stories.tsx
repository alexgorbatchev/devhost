import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ChatSettings } from "../ChatSettings";
import { PageChatScene, ShadowPageChatScene, installPageChatCatalog } from "./helpers";
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
    await within(dialog).findByRole("option", { name: "Discovered Codex model" });
    await userEvent.selectOptions(model, "codex-discovered");
    expect(model).toHaveValue("codex-discovered");
    expect(model.getBoundingClientRect().height).toBeGreaterThanOrEqual(28);
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
        (root as ShadowRoot).elementFromPoint(
          rectangle.left + rectangle.width / 2,
          rectangle.top + rectangle.height / 2,
        ),
      ).toBe(model),
    );
    await within(dialog).findByRole("option", { name: "Discovered Codex model" });
    await nativeUserEvent.selectOptions(model, "codex-discovered");
    expect(model).toHaveValue("codex-discovered");
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
