import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";
import { ChatDecisionPrompt } from "../ChatDecisionPrompt";
import { fixture_reloadSession } from "./fixtures";

const agent = { key: "k", harness: "codex", subdirectory: ".", lastActivity: 1, isOwned: false };

const meta: Meta<typeof ChatDecisionPrompt> = {
  component: ChatDecisionPrompt,
  title: "@alexgorbatchev/devhost-ui/devtools/features/agentChat/components/ChatDecisionPrompt",
  args: { onDecide: fn() },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const NamesEachForeignAgentsState: Story = {
  args: {
    decision: {
      kind: "agents",
      agents: [
        { ...agent, state: "working" },
        { ...agent, key: "a", state: "waiting", name: "review", subdirectory: "packages/ui" },
        { ...agent, key: "b", state: "unknown" },
      ],
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("codex is working in this checkout.")).toBeVisible();
    expect(canvas.getByText("codex (review) is waiting for approval in packages/ui.")).toBeVisible();
    expect(canvas.getByText("codex is running in this checkout; its state is unknown.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Start Anyway" }));
    expect(args.onDecide).toHaveBeenCalledWith({ kind: "start" });
  },
};

export const OffersEachRunningConversation: Story = {
  args: {
    decision: { kind: "sessions", sessions: [fixture_reloadSession, { ...fixture_reloadSession, id: "second" }] },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "codex · second" }));
    expect(args.onDecide).toHaveBeenCalledWith({
      kind: "join",
      session: expect.objectContaining({ id: "second" }),
    });
  },
};

export const CancelChoosesNothing: Story = {
  args: { decision: { kind: "sessions", sessions: [fixture_reloadSession] } },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Cancel" }));
    expect(args.onDecide).toHaveBeenCalledWith({ kind: "cancel" });
  },
};
