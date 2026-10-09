import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import { ToolbarPopover } from "../../../../shared/components/ToolbarPopover";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../../shared/components/stories/helpers";
import { StoppedServices } from "../StoppedServices";
import { fixture_stoppedServices } from "./fixtures";

const meta: Meta<typeof StoppedServices> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/serviceStatusPanel/components/StoppedServices",
  component: StoppedServices,
  args: {
    services: fixture_stoppedServices,
    isBlocked: false,
    onStart: fn(async () => null),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <ToolbarPopover
            panelLabel="Stopped services"
            panelWidth="sm"
            testId="StoppedServicesStory"
            triggerContent="Stopped"
            triggerLabel="Stopped"
          >
            <StoppedServices {...args} />
          </ToolbarPopover>
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Stopped" }));
    const start = canvas.getByRole("button", { name: "Start docs" });
    await waitFor(() => expect(start).toBeVisible());
    // The list keeps the order of the manifest.
    const startLabels = canvas
      .getAllByRole("button", { name: /^Start / })
      .map((button: HTMLElement) => button.getAttribute("aria-label"));
    await expect(startLabels).toEqual(["Start docs", "Start admin", "Start mail"]);
    await userEvent.click(start);
    await expect(args.onStart).toHaveBeenCalledWith(["docs"]);
    await waitFor(() => expect(canvas.getByRole("button", { name: "Start docs" })).toBeEnabled());
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const Starting: Story = {
  args: {
    // The request stays open, as it does while the service waits for its health check.
    onStart: fn(() => new Promise<string | null>(() => {})),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Stopped" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Start admin" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Start admin" })).toHaveTextContent("Starting…"));
    await expect(canvas.getByRole("button", { name: "Start admin" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Start docs" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Start mail" })).toBeDisabled();
    await expect(args.onStart).toHaveBeenCalledTimes(1);
  },
};

export const StartFailed: Story = {
  args: {
    onStart: fn(async () => "Failed to start docs: Service docs exited before passing its health check with code 1."),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Stopped" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Start docs" }));
    await waitFor(() =>
      expect(canvas.getByRole("alert")).toHaveTextContent(
        "Failed to start docs: Service docs exited before passing its health check with code 1.",
      ),
    );
    // The service stays in the list, and the start can be tried again.
    await expect(canvas.getByRole("button", { name: "Start docs" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Start docs" })).toHaveTextContent("Start");
  },
};

export const BlockedWhileServicesRestart: Story = {
  args: { isBlocked: true },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Stopped" }));
    const start = await canvas.findByRole("button", { name: "Start docs" });
    await waitFor(() => expect(start).toBeVisible());
    await expect(start).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Start admin" })).toBeDisabled();
    await expect(args.onStart).not.toHaveBeenCalled();
  },
};
