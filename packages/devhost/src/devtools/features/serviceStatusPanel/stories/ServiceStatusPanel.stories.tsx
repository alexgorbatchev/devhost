import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  DEVTOOLS_CONTROL_TOKEN_HEADER_NAME,
  readDevtoolsControlToken,
  RESTART_SERVICE_PATH,
  ThemeProvider,
} from "../../../shared";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { ServiceStatusPanel } from "../ServiceStatusPanel";

const meta: Meta<typeof ServiceStatusPanel> = {
  title: "@alexgorbatchev/devhost/devtools/features/serviceStatusPanel/ServiceStatusPanel",
  component: ServiceStatusPanel,
  render: (args) => {
    return (
      <ThemeProvider colorScheme="dark">
        <StoryContainer align={args.panelSide}>
          <ServiceStatusPanel {...args} />
        </StoryContainer>
      </ThemeProvider>
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const DefaultLeft: Story = {
  args: {
    errorMessage: null,
    panelSide: "left",
    services: [
      { name: "api", status: true },
      { name: "worker", status: false },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const panel = await canvas.findByTestId("ServiceStatusPanel");

    await expect(panel).toBeInTheDocument();
    await expect(canvas.getByText("worker")).toBeInTheDocument();
    await expect(canvas.getByText("api")).toBeInTheDocument();

    const restartFetch = fn(async () => new Response(null, { status: 204 }));
    const originalFetch = globalThis.fetch;

    Reflect.set(globalThis, "fetch", restartFetch as unknown as typeof fetch);

    try {
      await userEvent.hover(panel);
      await userEvent.click(canvas.getByRole("button", { name: "Restart api" }));

      await expect(restartFetch).toHaveBeenCalledWith(
        RESTART_SERVICE_PATH,
        expect.objectContaining({
          body: JSON.stringify({ serviceName: "api" }),
          headers: expect.objectContaining({
            [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: readDevtoolsControlToken(),
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

export const RightPanel: Story = {
  args: {
    errorMessage: null,
    panelSide: "right",
    services: [
      { name: "frontend", status: true },
      { name: "backend", status: true },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("ServiceStatusPanel")).toBeInTheDocument();
    await expect(canvas.getByText("frontend")).toBeInTheDocument();
    await expect(canvas.getByText("backend")).toBeInTheDocument();
  },
};

export const WithLinks: Story = {
  args: {
    errorMessage: null,
    panelSide: "left",
    services: [
      { name: "web", status: true, url: "http://localhost:3000" },
      { name: "docs", status: true, url: "http://localhost:3001" },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("ServiceStatusPanel")).toBeInTheDocument();
    const webLink = canvas.getByRole("link", { name: "web" });
    await expect(webLink).toBeInTheDocument();
    await expect(webLink).toHaveAttribute("href", "http://localhost:3000");
  },
};

export const WithErrorMessage: Story = {
  args: {
    errorMessage: "Connection to devhost lost",
    panelSide: "left",
    services: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId("ServiceStatusPanel")).toBeInTheDocument();
    await expect(canvas.getByText("Connection to devhost lost")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: {
    errorMessage: null,
    panelSide: "left",
    services: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    // Should render nothing
    await expect(canvas.queryByTestId("ServiceStatusPanel")).not.toBeInTheDocument();
  },
};
