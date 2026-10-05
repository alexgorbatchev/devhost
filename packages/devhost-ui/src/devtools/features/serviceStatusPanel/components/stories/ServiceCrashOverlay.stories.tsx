import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../../shared/components/stories/helpers";
import { ServiceCrashOverlay } from "../ServiceCrashOverlay";

const meta: Meta<typeof ServiceCrashOverlay> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/serviceStatusPanel/components/ServiceCrashOverlay",
  component: ServiceCrashOverlay,
  args: {
    services: [{ managed: true, name: "api", status: false, exitCode: 7 }],
    entries: [
      { id: 1, serviceName: "api", stream: "stdout", line: "Listening on port 3000" },
      { id: 2, serviceName: "api", stream: "stderr", line: "\u001b[31mFatal: database connection lost\u001b[0m" },
      { id: 3, serviceName: "worker", stream: "stdout", line: "Worker ready" },
    ],
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <ServiceCrashOverlay {...args} />
      </StorybookThemeProvider>,
    ),
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Crashed: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const dialog = await canvas.findByRole("dialog", { name: "Service exited" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getBoundingClientRect().width).toBe(window.innerWidth);
    await expect(dialog.getBoundingClientRect().height).toBe(window.innerHeight);
    const logs = within(dialog).getByRole("region", { name: "api logs" });
    await expect(logs).toHaveTextContent("stdout: Listening on port 3000stderr: Fatal: database connection lost");
    await expect(within(dialog).queryByText("Worker ready")).toBeNull();
    const button = within(dialog).getByRole("button", { name: "Restart api" });
    await expect((button.getRootNode() as ShadowRoot).activeElement).toBe(button);
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toBeVisible();
    const request = fn(async () => new Response(null, { status: 204 }));
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis, "fetch", request);
    try {
      await userEvent.click(button);
      await expect(request).toHaveBeenCalledWith("/__devhost__/restart-service", {
        body: '{"serviceNames":["api"]}',
        headers: { "content-type": "application/json", "x-devhost-control-token": "storybook-token" },
        method: "POST",
      });
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};

export const SuccessfulExit: Story = {
  args: { services: [{ managed: true, name: "api", status: false, exitCode: 0 }] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "api (exit code 0)" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Restart api" })).toBeEnabled();
  },
};

export const NoLogs: Story = {
  args: { entries: [] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(await canvas.findByRole("region", { name: "api logs" })).toHaveTextContent(
      "No retained logs for this service.",
    );
    await expect(canvas.getByRole("button", { name: "Restart api" })).toBeEnabled();
  },
};

export const Restarting: Story = {
  args: { services: [{ managed: true, name: "api", status: false, exitCode: 7, restarting: true }] },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Restarting api…" })).toBeDisabled();
    await expect(canvas.getByRole("region", { name: "api logs" })).toBeVisible();
  },
};

export const RestartFailure: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const request = fn(async () => new Response("Service api exited with code 1.", { status: 500 }));
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis, "fetch", request);
    try {
      await userEvent.click(await canvas.findByRole("button", { name: "Restart api" }));
      await expect(await canvas.findByRole("alert")).toHaveTextContent(
        "Failed to restart api: Service api exited with code 1.",
      );
      await waitFor(() => expect(canvas.getByRole("button", { name: "Restart api" })).toBeEnabled());
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};

export const MultipleServices: Story = {
  args: {
    services: [
      { managed: true, name: "api", status: false, exitCode: 7 },
      { managed: true, name: "worker", status: false, exitCode: 1 },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const api = await canvas.findByRole("region", { name: "api recovery" });
    const worker = canvas.getByRole("region", { name: "worker recovery" });
    await expect(within(api).getByRole("button", { name: "Restart api" })).toBeEnabled();
    await expect(within(worker).getByRole("button", { name: "Restart worker" })).toBeEnabled();
    await expect(within(worker).getByRole("region", { name: "worker logs" })).toHaveTextContent("stdout: Worker ready");
  },
};
