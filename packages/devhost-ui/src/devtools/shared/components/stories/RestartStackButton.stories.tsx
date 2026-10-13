import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { RestartStackButton } from "../RestartStackButton";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot, StorybookThemeProvider } from "./helpers";

const meta: Meta<typeof RestartStackButton> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/RestartStackButton",
  component: RestartStackButton,
  args: { isDisabled: false, onPendingChange: fn() },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <RestartStackButton {...args} />
      </StorybookThemeProvider>,
    ),
};
export default meta;
type Story = StoryObj<typeof meta>;

export const ChangedPending: Story = {
  args: { restartChangedShortcut: "Alt+Ctrl+R" },
  play: async ({ args, canvasElement, mount, globals }): Promise<void> => {
    const response = Promise.withResolvers<string | null>();
    const restart = fn(() => response.promise);
    await mount(
      renderInDevtoolsStoryShadowRoot(
        <StorybookThemeProvider globals={globals}>
          <RestartStackButton {...args} onRestartChanged={restart} />
        </StorybookThemeProvider>,
      ),
    );
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Restart Changed" }));
      await expect(await canvas.findByRole("button", { name: "Restarting…" })).toBeDisabled();
      await expect(canvas.getByRole("button", { name: "Restart Stack" })).toBeDisabled();
      await expect(args.onPendingChange).toHaveBeenCalledWith(true);
      response.resolve(null);
      await waitFor(() => expect(canvas.getByRole("button", { name: "Restart Changed" })).toBeEnabled());
      await expect(args.onPendingChange).toHaveBeenLastCalledWith(false);
      await expect(restart).toHaveBeenCalledTimes(1);
    } finally {
      response.resolve(null);
    }
  },
};

export const ChangedFailure: Story = {
  args: {
    onRestartChanged: fn(async () => "Failed to restart api: connection lost"),
    restartChangedShortcut: "Alt+Ctrl+R",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Restart Changed" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Service restart failedFailed to restart api: connection lost",
    );
    await expect(canvas.getByRole("button", { name: "Restart Changed" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Restart Stack" })).toBeEnabled();
  },
};

export const ChangedUnavailable: Story = {
  args: {
    onRestartChanged: fn(async () => null),
    isRestartChangedDisabled: true,
    restartChangedShortcut: "Alt+Ctrl+R",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const changed = canvas.getByRole("button", { name: "Restart Changed" });
    await expect(changed).toBeDisabled();
    await userEvent.click(changed);
    await expect(args.onRestartChanged).not.toHaveBeenCalled();
    await expect(canvas.getByRole("button", { name: "Restart Stack" })).toBeEnabled();
  },
};

export const Explanation: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = canvas.getByRole("button", { name: "Restart Stack" });
    await userEvent.hover(button);
    await expect(button).toHaveAttribute("title", "Restarts all managed services and reassigns automatic ports.");
    await expect(canvas.queryByRole("button", { name: "About Restart Stack" })).toBeNull();
  },
};

export const Ready: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Restart Stack" }));
    await waitFor(() => expect(args.onPendingChange).toHaveBeenLastCalledWith(false));
    await expect(args.onPendingChange).toHaveBeenCalledWith(true);
    await expect(canvas.queryByRole("alert")).toBeNull();
    await expect(canvas.getByRole("button", { name: "Restart Stack" })).toBeEnabled();
  },
};

export const Disabled: Story = {
  args: { isDisabled: true },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = canvas.getByRole("button", { name: "Restart Stack" });
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onPendingChange).not.toHaveBeenCalled();
  },
};

export const Pending: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const response = Promise.withResolvers<Response>();
    const request = fn(() => response.promise);
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis, "fetch", request);
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Restart Stack" }));
      const button = await canvas.findByRole("button", { name: "Restarting stack…" });
      await expect(button).toBeDisabled();
      await userEvent.click(button);
      await expect(request).toHaveBeenCalledTimes(1);
      response.resolve(new Response(null, { status: 204 }));
      await waitFor(() => expect(args.onPendingChange).toHaveBeenLastCalledWith(false));
      await expect(canvas.getByRole("button", { name: "Restart Stack" })).toBeEnabled();
    } finally {
      response.resolve(new Response(null, { status: 204 }));
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};

export const Failure: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const request = fn(async () => new Response("route refresh failed", { status: 500 }));
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis, "fetch", request);
    try {
      await userEvent.click(canvas.getByRole("button", { name: "Restart Stack" }));
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        "Stack restart failedFailed to restart stack: route refresh failed",
      );
      await waitFor(() => expect(canvas.getByRole("button", { name: "Restart Stack" })).toBeEnabled());
      request.mockResolvedValue(new Response(null, { status: 204 }));
      await userEvent.click(canvas.getByRole("button", { name: "Restart Stack" }));
      await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
      await expect(request).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};
