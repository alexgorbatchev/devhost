import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { App } from "../App";

const meta: Meta<typeof App> = {
  title: "devhost-test-app/app/App",
  component: App,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const themeSelect = canvas.getByLabelText("Toggle theme");
    const managedEdgeTab = canvas.getByRole("tab", { name: "Managed edge" });
    const runtimeContextTab = canvas.getByRole("tab", { name: "Runtime context" });
    const agentHandoffTab = canvas.getByRole("tab", { name: "Agent handoff" });

    await expect(
      canvas.getByRole("heading", {
        name: "replace localhost:3000 with https://app.localhost and then some more",
      }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(["dark", "light"]).toContain(document.documentElement.dataset.theme);
    });

    const initialTheme = document.documentElement.dataset.theme;
    await userEvent.click(themeSelect);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).not.toBe(initialTheme);
    });

    await expect(window.localStorage.getItem("devhost-test-theme")).toBe(document.documentElement.dataset.theme);

    await userEvent.click(managedEdgeTab);
    await expect(managedEdgeTab).toHaveAttribute("aria-selected", "true");

    await userEvent.click(runtimeContextTab);
    await expect(runtimeContextTab).toHaveAttribute("aria-selected", "true");

    await userEvent.click(agentHandoffTab);
    await expect(agentHandoffTab).toHaveAttribute("aria-selected", "true");
  },
};

export { Default as App };
