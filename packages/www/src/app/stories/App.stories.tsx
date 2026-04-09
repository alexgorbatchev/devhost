import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { App } from "../App";

const meta: Meta<typeof App> = {
  component: App,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const themeSelect = canvas.getByLabelText("Theme");
    const managedEdgeTab = canvas.getByRole("tab", { name: "Managed edge" });
    const runtimeContextTab = canvas.getByRole("tab", { name: "Runtime context" });
    const agentHandoffTab = canvas.getByRole("tab", { name: "Agent handoff" });
    const featureSection = canvas.getByRole("region", {
      name: "The route is just the start.",
    });
    const proofSection = canvas.getByRole("region", {
      name: "Serious local infrastructure, with honest boundaries.",
    });

    await expect(
      canvas.getByRole("heading", {
        name: "Give every local app a real front door.",
      }),
    ).toBeInTheDocument();
    await expect(
      within(featureSection).getByRole("heading", { name: "Runtime context without guesswork" }),
    ).toBeInTheDocument();
    await expect(
      within(proofSection).queryByRole("heading", { name: "Runtime context without guesswork" }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(themeSelect, "light");
    await expect(themeSelect).toHaveValue("light");
    await userEvent.click(managedEdgeTab);
    await expect(managedEdgeTab).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("heading", {
        level: 3,
        name: "Put every local service behind a real HTTPS front door",
      }),
    ).toBeInTheDocument();
    await userEvent.click(runtimeContextTab);
    await expect(runtimeContextTab).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("heading", {
        level: 3,
        name: "Give each service the right context without hard-coding the local stack",
      }),
    ).toBeInTheDocument();
    await userEvent.click(agentHandoffTab);
    await expect(agentHandoffTab).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("heading", {
        level: 3,
        name: "Turn a page bug into a live coding session with context attached",
      }),
    ).toBeInTheDocument();
  },
};

export { Default as App };
