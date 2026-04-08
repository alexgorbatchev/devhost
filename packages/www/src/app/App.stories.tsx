import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { App } from "./App";

const meta: Meta<typeof App> = {
  component: App,
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  args: {},
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const themeSelect = canvas.getByLabelText("Theme");
    const annotationTab = canvas.getByRole("tab", { name: "Annotation handoff" });
    const sourceNavigationTab = canvas.getByRole("tab", { name: "Source navigation" });
    const routingHealthTab = canvas.getByRole("tab", { name: "Routing + health" });
    const featureSection = canvas.getByRole("region", {
      name: "A routed development surface, not another localhost wrapper.",
    });
    const proofSection = canvas.getByRole("region", {
      name: "The page now sells the real constraints, not decorative abstractions.",
    });

    await expect(
      canvas.getByRole("heading", {
        name: "devhost is the storefront for routed local stacks.",
      }),
    ).toBeInTheDocument();
    await expect(
      within(featureSection).getByRole("heading", { name: "Local HTTPS is a first-class workflow" }),
    ).toBeInTheDocument();
    await expect(
      within(proofSection).queryByRole("heading", { name: "Local HTTPS is a first-class workflow" }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(themeSelect, "light");
    await expect(themeSelect).toHaveValue("light");
    await userEvent.click(annotationTab);
    await expect(annotationTab).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Send annotated page state straight into Pi" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("89 events")).not.toBeInTheDocument();
    await expect(canvas.queryByText("13.2 s capture")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Keyboard controlled")).not.toBeInTheDocument();
    await userEvent.click(sourceNavigationTab);
    await expect(sourceNavigationTab).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("heading", { level: 3, name: "Editor-aware component jumps" })).toBeInTheDocument();
    await userEvent.click(routingHealthTab);
    await expect(routingHealthTab).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Reserve the host, wait for health, then expose the route" }),
    ).toBeInTheDocument();
  },
};

export { Default as App };
