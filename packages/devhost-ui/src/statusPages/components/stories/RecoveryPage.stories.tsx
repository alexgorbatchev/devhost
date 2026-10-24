import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { RecoveryPage } from "../RecoveryPage";
import { fixture_state } from "./fixtures";
import { createStoryClient } from "./helpers";

const meta: Meta<typeof RecoveryPage> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/RecoveryPage",
  component: RecoveryPage,
  args: { initial: fixture_state, status: 503, client: createStoryClient() },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Recovery: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const restart = canvas.getByRole("button", { name: "Restart web" });
    await waitFor(() => expect(restart).toBeEnabled());
    await userEvent.click(restart);
    await expect(args.client.restart).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole("button", { name: "Recent logs" }));
    await waitFor(() => expect(canvas.queryByText("Compiler failed to resolve import")).toBeNull());
    await userEvent.click(canvas.getByRole("button", { name: "Recent logs" }));
    await expect(canvas.getByText("Compiler failed to resolve import")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Refresh worktrees" }));
    await expect(args.client.readWorktrees).toHaveBeenCalledTimes(2);
  },
};
export const RestartFailure: Story = {
  args: {
    client: {
      ...createStoryClient(),
      restart: fn(async () => {
        throw new Error("Port is occupied");
      }),
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const restart = canvas.getByRole("button", { name: "Restart web" });
    await waitFor(() => expect(restart).toBeEnabled());
    await userEvent.click(restart);
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Port is occupied");
    await expect(restart).toBeEnabled();
  },
};
export const ExternalService: Story = {
  args: {
    initial: { ...fixture_state, canRestart: false, repositories: [] },
    client: {
      ...createStoryClient(),
      readStatus: fn(async () => ({ ...fixture_state, canRestart: false, repositories: [] })),
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Restart web" })).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: "Refresh worktrees" })).toBeNull();
  },
};
export const Disconnected: Story = {
  args: {
    client: {
      ...createStoryClient(),
      readStatus: fn(async () => {
        throw new Error("Devhost is unavailable. Waiting to reconnect…");
      }),
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Devhost is unavailable. Waiting to reconnect…")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Restart web" })).toBeDisabled();
  },
};
