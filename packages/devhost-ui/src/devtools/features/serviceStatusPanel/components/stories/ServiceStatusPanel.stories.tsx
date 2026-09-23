import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, RESTART_SERVICE_PATH } from "../../../../shared";
import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import { readInjectedDevtoolsConfig } from "../../../../shared/readInjectedDevtoolsConfig";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { ServiceStatusPanel } from "../ServiceStatusPanel";

const meta: Meta<typeof ServiceStatusPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/serviceStatusPanel/components/ServiceStatusPanel",
  component: ServiceStatusPanel,
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <ServiceStatusPanel {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "api", status: true },
      { managed: false, name: "worker", status: false },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 1 of 2 up" }));

    const panel = await shadowCanvas.findByRole("region", { name: "Services" });

    await waitFor(() => expect(panel).toBeVisible());
    await expect(shadowCanvas.getByText("external")).toBeVisible();
    await expect(shadowCanvas.queryByText("managed")).toBeNull();
    await expect(shadowCanvas.queryByRole("button", { name: "Restart worker" })).toBeNull();

    const restartFetch = fn(async () => new Response(null, { status: 204 }));
    const originalFetch = globalThis.fetch;

    Reflect.set(globalThis, "fetch", restartFetch as unknown as typeof fetch);

    try {
      await userEvent.click(shadowCanvas.getByRole("button", { name: "Restart api" }));

      await expect(restartFetch).toHaveBeenCalledWith(
        RESTART_SERVICE_PATH,
        expect.objectContaining({
          body: JSON.stringify({ serviceName: "api" }),
          headers: expect.objectContaining({
            [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: readInjectedDevtoolsConfig().controlToken,
            "content-type": "application/json",
          }),
          method: "POST",
        }),
      );
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};

export const ChangedService: Story = {
  args: {
    errorMessage: null,
    services: [
      { dirty: true, managed: true, name: "api", status: true },
      { managed: true, name: "web", status: true },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await shadowCanvas.findByRole("button", { name: "Services: 2 of 2 up, 1 changed" });

    await expect(trigger).toHaveTextContent("1 changed");
    await userEvent.click(trigger);
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("button", { name: "Restart api" })).toBeEnabled();
  },
};

export const RestartingService: Story = {
  args: {
    errorMessage: null,
    services: [{ managed: true, name: "api", restarting: true, status: true }],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 1 of 1 up" }));
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("button", { name: "Restart api" })).toBeDisabled();
  },
};

export const WithLinks: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "web", status: true, url: "http://localhost:3000" },
      { managed: false, name: "docs", status: true, url: "http://localhost:3001" },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 2 of 2 up" }));
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("link", { name: "web" })).toHaveAttribute("href", "http://localhost:3000");
    await expect(shadowCanvas.queryByRole("button", { name: "Restart docs" })).toBeNull();
  },
};

export const WithErrorMessage: Story = {
  args: {
    errorMessage: "Connection to devhost lost",
    onSetErrorMessage: fn(),
    services: [],
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 0 of 0 up, error" }));
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("alert")).toHaveTextContent("Connection to devhost lost");

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Dismiss" }));
    await expect(args.onSetErrorMessage).toHaveBeenCalledWith(null);
  },
};

export const Empty: Story = {
  args: {
    errorMessage: null,
    services: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(await shadowCanvas.findByRole("toolbar", { name: "devhost" })).toBeVisible();
    await expect(shadowCanvas.queryByRole("button", { name: /^Services/ })).toBeNull();
  },
};
