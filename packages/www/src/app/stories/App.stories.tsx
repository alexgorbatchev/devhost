import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { App } from "../App";
import { withDevhostMock } from "./withDevhostMock";

const meta: Meta<typeof App> = {
  title: "devhost-test-app/app/App",
  component: App,
  decorators: [withDevhostMock],
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

    await userEvent.click(themeSelect);

    await userEvent.click(managedEdgeTab);
    await expect(managedEdgeTab).toHaveAttribute("aria-selected", "true");

    await userEvent.click(runtimeContextTab);
    await expect(runtimeContextTab).toHaveAttribute("aria-selected", "true");

    await userEvent.click(agentHandoffTab);
    await expect(agentHandoffTab).toHaveAttribute("aria-selected", "true");

    // Devhost UI Assertions:

    // Wait for devhost container to exist in the DOM body
    await waitFor(
      () => {
        expect(document.getElementById("devhost-devtools-host")).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    const devtoolsHost = document.getElementById("devhost-devtools-host");
    if (!devtoolsHost || !devtoolsHost.shadowRoot) throw new Error("Missing Devhost ShadowRoot");

    // Create a generic within scope for the shadow root
    const rootNode = devtoolsHost.shadowRoot.querySelector("div");
    if (!rootNode) throw new Error("No div in shadow root");
    const shadowScope = within(rootNode as HTMLElement);

    // 1. Multiple services (main, api subpath, worker secondary)
    await shadowScope.findByText("app", { selector: "span" }, { timeout: 5000 });
    await shadowScope.findByText("api", { selector: "span" });

    // 2. Logs should be populated
    await shadowScope.findByTestId("LogMinimap", undefined, { timeout: 5000 });

    // 3. Annotation queue prepopulated with 3 items
    await shadowScope.findByDisplayValue("Change the primary button color to blue.");
    await shadowScope.findByText("3 items", { selector: "span" });

    // 4. One Pi active session and one Nvim
    await shadowScope.findAllByTestId("TerminalSessionTray", undefined, { timeout: 5000 });
  },
};

export { Default as App };
