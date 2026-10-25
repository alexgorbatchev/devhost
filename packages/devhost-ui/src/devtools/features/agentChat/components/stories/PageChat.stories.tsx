import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { assert } from "vitest";
import { userEvent } from "vitest/browser";
import { z } from "zod";
import {
  PageChatScene,
  ShadowPageChatScene,
  dragWithMouse,
  installPageChatCatalog,
  readModalAnnotationCanvas,
  installChatReloadServer,
  chooseChatSetting,
  readSentChatCommands,
  acknowledgeChatSend,
} from "./helpers";
import {
  devtoolsStoryShadowRootHostTestId,
  expectDevtoolsSurfaceAbove,
  readDevtoolsStoryShadowCanvas,
  readShadowRoot,
} from "../../../../shared/components/stories/helpers";
import { PageChat } from "../PageChat";

const meta: Meta<typeof PageChat> = {
  component: PageChat,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/PageChat",
  render: () => <PageChatScene />,
  beforeEach: installPageChatCatalog,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const SendSelectedContextWithoutSharing: Story = {
  beforeEach: () => installChatReloadServer([]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    await chooseChatSetting(canvas, "Conversation", "codex · saved-conversation");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Select Elements" }));
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await userEvent.keyboard("{Escape}");
    await canvas.findByRole("region", { name: "Page context" });
    await userEvent.type(canvas.getByRole("textbox", { name: "Message input" }), "Review the counter");
    await userEvent.click(canvas.getByRole("button", { name: "Send Message" }));
    await waitFor(() => expect(readSentChatCommands()).toHaveLength(1));
    const command = z
      .object({ commandId: z.string(), text: z.string(), images: z.unknown().optional() })
      .parse(readSentChatCommands()[0]);
    expect(command.images).toBeUndefined();
    const context = z
      .object({
        markers: z.array(z.object({ element: z.string() })),
        shapes: z.array(z.unknown()),
        screenshot: z.unknown().optional(),
      })
      .parse(JSON.parse(command.text.split("\n").at(-1) ?? ""));
    expect(context.markers).toHaveLength(1);
    expect(context.shapes).toEqual([]);
    expect(context.screenshot).toBeUndefined();
    expect(canvas.getByRole("button", { name: "Share Tab" })).toBeVisible();
    acknowledgeChatSend(command.commandId);
    await waitFor(() => expect(canvas.queryByRole("region", { name: "Page context" })).toBeNull());
  },
};

export const FloatingToolsAndSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    const toolbar = canvas.getByRole("toolbar", { name: "Page Annotation Tools" });
    expect(toolbar.getBoundingClientRect().top).toBeLessThan(24);
    expect(canvas.getByRole("button", { name: "Arrow" }).getBoundingClientRect().height).toBeGreaterThanOrEqual(36);
    expect(canvas.queryByRole("combobox", { name: "Harness" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
    const dialog = await canvas.findByRole("dialog", { name: "Chat Settings" });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Harness" })).toBeVisible());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Chat Settings" })).toHaveFocus());
    await expect(canvas.getByRole("button", { name: "Share Tab" })).toBeVisible();
  },
};

export const RemoveIndividualContext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Select Elements" }));
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Remove Element 1" }));
    await expect(canvas.queryByRole("region", { name: "Page context" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Box" }));
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 80, y: 120 },
      targetPosition: { x: 220, y: 220 },
    });
    await userEvent.click(canvas.getByRole("button", { name: "Remove Box 1" }));
    await expect(canvas.queryByRole("img", { name: "box annotation" })).toBeNull();
  },
};

export const PageRemainsInteractive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Open chat" }));
    await expect(canvas.getByRole("complementary", { name: "Agent chat" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Move Chat To Left" }));
    await expect(canvas.getByRole("button", { name: "Move Chat To Right" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Collapse Chat" }));
    await expect(canvas.queryByRole("complementary", { name: "Agent chat" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 1" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 2" })).toBeVisible();
  },
};

export const SelectionBecomesChatContext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Select Elements" }));
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(await canvas.findByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    await expect(canvas.getByRole("button", { name: "Page counter: 0" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear Page Context" }));
    await expect(canvas.queryByRole("region", { name: "Page context" })).not.toBeInTheDocument();
  },
};

export const DrawAndUndo: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await userEvent.click(canvas.getByRole("button", { name: "Arrow" }));
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 80, y: 120 },
      targetPosition: { x: 220, y: 220 },
    });
    await expect(canvas.getByRole("img", { name: "arrow annotation" })).toBeVisible();
    await expect(canvas.getByRole("region", { name: "Page context" })).toHaveTextContent("1. arrow");
    await expect(canvas.getByRole("button", { name: "Arrow" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Undo Drawing" }));
    await expect(canvas.queryByRole("img", { name: "arrow annotation" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("region", { name: "Page context" })).not.toBeInTheDocument();
  },
};

/** Chatting in the devhost checkout makes devhost's own UI the subject: it is selectable and drawn over. */
export const AnnotateDevhostUI: Story = {
  render: () => <ShadowPageChatScene target="devhost" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const shadowRoot = readShadowRoot(
      canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
      "The story did not attach a devtools shadow root.",
    );
    const select = await shadowCanvas.findByRole("button", { name: "Select Elements" });
    const settings = shadowCanvas.getByRole("button", { name: "Chat Settings" });
    await userEvent.click(select);
    await userEvent.click(settings);
    await expect(await shadowCanvas.findByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    expect(shadowCanvas.queryByRole("dialog", { name: "Chat Settings" })).toBeNull();
    await userEvent.click(select);
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(shadowCanvas.getByRole("button", { name: "Box" }));
    const surface = shadowCanvas.getByRole("img", { name: "Annotation drawing canvas" });
    const chat = shadowCanvas.getByRole("complementary", { name: "Agent chat" }).getBoundingClientRect();
    const x = chat.left + 30;
    const y = chat.top + 60;
    expect(shadowRoot.elementFromPoint(x, y)).toBe(surface);
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x, y },
      targetPosition: { x: x + 120, y: y + 80 },
    });
    await expect(shadowCanvas.getByRole("img", { name: "box annotation" })).toBeVisible();
    await expect(shadowCanvas.getByRole("button", { name: "Box" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(settings);
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Chat Settings" });
    await waitFor(() => expect(dialog).toBeVisible());
  },
};

/** Chatting in the project keeps devhost's UI working above the page's selections and drawings. */
export const ProjectAnnotationsStayBelowDevhostUI: Story = {
  render: () => <ShadowPageChatScene hasNativeLayers />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const shadowRoot = readShadowRoot(
      canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
      "The story did not attach a devtools shadow root.",
    );
    const tools = shadowCanvas.getByRole("toolbar", { name: "Page Annotation Tools" });
    const chat = shadowCanvas.getByRole("complementary", { name: "Agent chat" });
    const dock = shadowCanvas.getByRole("button", { name: "Native panel" });
    // The chat panel covers the dock on the right.
    await userEvent.click(shadowCanvas.getByRole("button", { name: "Move Chat To Left" }));
    await userEvent.click(within(tools).getByRole("button", { name: "Select Elements" }));
    // Devhost controls keep working during selection instead of becoming context.
    await userEvent.click(shadowCanvas.getByRole("button", { name: "Chat Settings" }));
    const dialog = await shadowCanvas.findByRole("dialog", { name: "Chat Settings" });
    expect(shadowCanvas.queryByRole("region", { name: "Page context" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(shadowCanvas.queryByRole("dialog", { name: "Chat Settings" })).toBeNull());
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(await shadowCanvas.findByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(tools).getByRole("button", { name: "Box" }));
    const surface = shadowCanvas.getByRole("img", { name: "Annotation drawing canvas" });
    const panel = chat.getBoundingClientRect();
    const toolbar = dock.getBoundingClientRect();
    // The chat panel receives the pointer where it covers the drawing surface.
    expect(chat.contains(shadowRoot.elementFromPoint(panel.left + 30, panel.top + 60))).toBe(true);
    await dragWithMouse({ x: panel.right + 120, y: panel.top + 200 }, { x: panel.right - 60, y: panel.top + 260 });
    await userEvent.click(within(tools).getByRole("button", { name: "Box" }));
    await dragWithMouse({ x: toolbar.left - 80, y: toolbar.top - 60 }, { x: toolbar.right - 2, y: toolbar.bottom - 2 });
    const [panelBox, dockBox] = within(surface).getAllByRole("img", { name: "box annotation" });
    assert(panelBox && dockBox);
    await waitFor(() => {
      expectDevtoolsSurfaceAbove(shadowRoot, chat, panelBox);
      expectDevtoolsSurfaceAbove(shadowRoot, dock, dockBox);
    });
    // A host popover opened later: the drawings follow it into the top layer, and chat re-enters above them.
    const hostPopover = document.createElement("div");
    hostPopover.popover = "manual";
    hostPopover.textContent = "Host popover";
    document.body.append(hostPopover);
    try {
      hostPopover.showPopover();
      const overlap = panelBox.getBoundingClientRect();
      await waitFor(() => {
        const chatTree = chat.getRootNode();
        const drawingTree = panelBox.getRootNode();
        assert(chatTree instanceof ShadowRoot && drawingTree instanceof ShadowRoot);
        expect(hostPopover.contains(drawingTree.host)).toBe(true);
        expect(document.elementFromPoint(overlap.left + 10, overlap.top + 30)).toBe(chatTree.host);
      });
    } finally {
      hostPopover.remove();
    }
  },
};

/** A devhost toolbar panel is a native popover: the devhost target annotates it without dismissing it. */
export const AnnotateNativePopover: Story = {
  render: () => <ShadowPageChatScene hasNativeLayers target="devhost" />,
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const tools = canvas.getByRole("toolbar", { name: "Page Annotation Tools" });
    await userEvent.click(canvas.getByRole("button", { name: "Move Chat To Left" }));
    await userEvent.click(canvas.getByRole("button", { name: "Native panel" }));
    const panel = await canvas.findByRole("region", { name: "Native panel" });
    await waitFor(() => expect(panel).toBeVisible());
    const bounds = panel.getBoundingClientRect();
    await userEvent.click(within(tools).getByRole("button", { name: "Box" }));
    expect(panel.matches(":popover-open")).toBe(true);
    await dragWithMouse({ x: bounds.left + 8, y: bounds.top + 8 }, { x: bounds.right - 8, y: bounds.bottom - 8 });
    await expect(canvas.getByRole("img", { name: "box annotation" })).toBeVisible();
    expect(panel.matches(":popover-open")).toBe(true);
    expect(panel.getBoundingClientRect().toJSON()).toEqual(bounds.toJSON());
    await userEvent.click(within(tools).getByRole("button", { name: "Select Elements" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Panel counter: 0" }));
    await expect(canvas.getByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    await userEvent.keyboard("{Escape}");
    expect(panel.matches(":popover-open")).toBe(true);
    await userEvent.click(within(tools).getByRole("button", { name: "Undo Drawing" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Panel counter: 0" }));
    await expect(within(panel).getByRole("button", { name: "Panel counter: 1" })).toBeVisible();
    await expect(canvas.queryByRole("img", { name: "box annotation" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(panel.matches(":popover-open")).toBe(false));
  },
};

export const AnnotateNativeModal: Story = {
  render: () => <ShadowPageChatScene hasNativeLayers />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devtools = await readDevtoolsStoryShadowCanvas(canvasElement);
    const tools = devtools.getByRole("toolbar", { name: "Page Annotation Tools" });
    const panel = devtools.getByRole("complementary", { name: "Agent chat" });
    await userEvent.click(canvas.getByRole("button", { name: "Open host modal" }));
    const modal = canvas.getByRole("dialog", { name: "Host modal" });
    await waitFor(() => expect(modal.matches(":modal")).toBe(true));
    const bounds = modal.getBoundingClientRect();
    const toolBounds = tools.getBoundingClientRect();
    // The annotation tools must receive real pointer input outside the active modal's visible rectangle.
    expect(document.elementFromPoint(toolBounds.left + 4, toolBounds.top + 4)).not.toBe(modal);
    await userEvent.click(within(tools).getByRole("button", { name: "Box" }));
    // The drawing surface shows once there is something to draw, inside the modal it annotates.
    const surface = await waitFor(() => readModalAnnotationCanvas(modal));
    const tree = surface.getRootNode() as ShadowRoot;
    expect(tree).toBeInstanceOf(ShadowRoot);
    expect(tree.elementFromPoint(bounds.left + 4, bounds.top + 4)).toBe(surface);
    await dragWithMouse({ x: bounds.left + 4, y: bounds.top + 4 }, { x: bounds.right - 4, y: bounds.bottom - 4 });
    await expect(within(surface).getByRole("img", { name: "box annotation" })).toBeVisible();
    await userEvent.click(within(tools).getByRole("button", { name: "Select Elements" }));
    await userEvent.click(within(modal).getByRole("button", { name: "Modal counter: 0" }));
    await expect(within(panel).getByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    const composer = within(panel).getByRole("textbox", { name: "Message input" });
    await userEvent.keyboard("{Escape}");
    expect(modal.matches(":modal")).toBe(true);
    expect(modal.getBoundingClientRect().toJSON()).toEqual(bounds.toJSON());
    await userEvent.fill(composer, "Review this modal.");
    await expect(composer).toHaveValue("Review this modal.");
    await userEvent.click(within(modal).getByRole("button", { name: "Modal counter: 0" }));
    await expect(within(modal).getByRole("button", { name: "Modal counter: 1" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(modal.matches(":modal")).toBe(false));
    await waitFor(() => expect(devtools.getByRole("toolbar", { name: "Page Annotation Tools" })).toBe(tools));
    await userEvent.click(within(tools).getByRole("button", { name: "Undo Drawing" }));
    await expect(devtools.queryByRole("img", { name: "box annotation" })).toBeNull();
  },
};

export const OpeningChatFocusesComposer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    await waitFor(() => expect(canvas.getByRole("textbox", { name: "Message input" })).toHaveFocus());
  },
};

export const AnnotationsFocusComposer: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open chat" }));
    const composer = await canvas.findByRole("textbox", { name: "Message input" });
    await userEvent.click(canvas.getByRole("button", { name: "Arrow" }));
    await expect(composer).not.toHaveFocus();
    const surface = canvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 80, y: 120 },
      targetPosition: { x: 220, y: 220 },
    });
    await expect(canvas.getByRole("img", { name: "arrow annotation" })).toBeVisible();
    await waitFor(() => expect(composer).toHaveFocus());
    await userEvent.click(canvas.getByRole("button", { name: "Select Elements" }));
    await expect(composer).not.toHaveFocus();
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(await canvas.findByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    await waitFor(() => expect(composer).toHaveFocus());
  },
};

export const EscapeInInjectedComposerEndsSelection: Story = {
  render: () => <ShadowPageChatScene />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const shadowRoot = readShadowRoot(
      canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
      "The story did not attach a devtools shadow root.",
    );
    const select = await shadowCanvas.findByRole("button", { name: "Select Elements" });
    await userEvent.click(select);
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(await shadowCanvas.findByRole("region", { name: "Page context" })).toHaveTextContent("#1");
    const composer = shadowCanvas.getByRole("textbox", { name: "Message input" });
    await waitFor(() => expect(shadowRoot.activeElement).toBe(composer));
    await userEvent.keyboard("{Escape}");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Page counter: 0" }));
    await expect(canvas.getByRole("button", { name: "Page counter: 1" })).toBeVisible();
  },
};

export const EscapeCancelsMoveWhileComposerHasFocus: Story = {
  render: () => <ShadowPageChatScene />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const shadowRoot = readShadowRoot(
      canvas.getByTestId(devtoolsStoryShadowRootHostTestId),
      "The story did not attach a devtools shadow root.",
    );
    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Arrow" }));
    const surface = shadowCanvas.getByRole("img", { name: "Annotation drawing canvas" });
    await userEvent.dragAndDrop(surface, surface, {
      sourcePosition: { x: 80, y: 120 },
      targetPosition: { x: 220, y: 220 },
    });
    const arrow = await shadowCanvas.findByRole("img", { name: "arrow annotation" });
    const composer = shadowCanvas.getByRole("textbox", { name: "Message input" });
    await waitFor(() => expect(shadowRoot.activeElement).toBe(composer));
    const placed = arrow.getBoundingClientRect();
    await dragWithMouse({ x: 150, y: 170 }, { x: 210, y: 240 }, "{Escape}");
    const cancelled = arrow.getBoundingClientRect();
    expect({ left: cancelled.left, top: cancelled.top }).toEqual({ left: placed.left, top: placed.top });
    await dragWithMouse({ x: 150, y: 170 }, { x: 210, y: 240 });
    await waitFor(() => expect(arrow.getBoundingClientRect().left).toBeCloseTo(placed.left + 60, 0));
    expect(arrow.getBoundingClientRect().top).toBeCloseTo(placed.top + 70, 0);
  },
};
