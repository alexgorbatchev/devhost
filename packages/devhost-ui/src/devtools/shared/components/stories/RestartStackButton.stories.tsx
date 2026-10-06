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

export const Ready: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Restart stack with new ports" }));
    await waitFor(() => expect(args.onPendingChange).toHaveBeenLastCalledWith(false));
    await expect(args.onPendingChange).toHaveBeenCalledWith(true);
    await expect(canvas.queryByRole("alert")).toBeNull();
    await expect(canvas.getByRole("button", { name: "Restart stack with new ports" })).toBeEnabled();
  },
};

export const Disabled: Story = {
  args: { isDisabled: true },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const button = canvas.getByRole("button", { name: "Restart stack with new ports" });
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
      await userEvent.click(canvas.getByRole("button", { name: "Restart stack with new ports" }));
      const button = await canvas.findByRole("button", { name: "Restarting stack…" });
      await expect(button).toBeDisabled();
      await userEvent.click(button);
      await expect(request).toHaveBeenCalledTimes(1);
      response.resolve(new Response(null, { status: 204 }));
      await waitFor(() => expect(args.onPendingChange).toHaveBeenLastCalledWith(false));
      await expect(canvas.getByRole("button", { name: "Restart stack with new ports" })).toBeEnabled();
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
      await userEvent.click(canvas.getByRole("button", { name: "Restart stack with new ports" }));
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        "Stack restart failedFailed to restart stack: route refresh failed",
      );
      await waitFor(() => expect(canvas.getByRole("button", { name: "Restart stack with new ports" })).toBeEnabled());
      request.mockResolvedValue(new Response(null, { status: 204 }));
      await userEvent.click(canvas.getByRole("button", { name: "Restart stack with new ports" }));
      await waitFor(() => expect(canvas.queryByRole("alert")).toBeNull());
      await expect(request).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};
