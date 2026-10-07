import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ReduxDevtoolsMonitor } from "../ReduxDevtoolsMonitor";
import { ReduxMonitorStory } from "./helpers";

const meta: Meta<typeof ReduxDevtoolsMonitor> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/reduxDevtools/components/ReduxDevtoolsMonitor",
  component: ReduxDevtoolsMonitor,
};
export default meta;
type Story = StoryObj<typeof meta>;

export const EmptyThenRegistered: Story = {
  render: () => <ReduxMonitorStory shouldRegisterInitially={false} />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const monitor = within(canvas.getByRole("region", { name: "Redux monitor" }));
    const options = within(canvasElement.ownerDocument.body);
    await userEvent.click(await monitor.findByRole("combobox"));
    await expect(options.queryByRole("option", { name: "Project A" })).toBeNull();
    await expect(options.queryByRole("option", { name: "Project B" })).toBeNull();
    await userEvent.click(options.getByRole("option", { name: "Autoselect instances" }));
    await userEvent.click(canvas.getByRole("button", { name: "Register Project A" }));
    await userEvent.click(monitor.getByRole("combobox"));
    await userEvent.click(await options.findByRole("option", { name: "Project A" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment Project A" }));
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("1");
    await waitFor(() => expect(monitor.getByRole("button", { name: "Go back" })).toBeEnabled());
    await userEvent.click(monitor.getByRole("button", { name: "Go back" }));
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("0");
    await expect(canvas.getByRole("status", { name: "Project B count" })).toHaveTextContent("10");
  },
};

export const LiveHistoryAndProjectSelection: Story = {
  render: () => <ReduxMonitorStory />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const monitor = within(canvas.getByRole("region", { name: "Redux monitor" }));
    await userEvent.click(await monitor.findByRole("combobox"));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Project A" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment Project A" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment Project A" }));
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("2");
    const back = monitor.getByRole("button", { name: "Go back" });
    await waitFor(() => expect(back).toBeEnabled());
    await userEvent.click(back);
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("1");
    await expect(canvas.getByRole("status", { name: "Project B count" })).toHaveTextContent("10");
    await userEvent.click(monitor.getByRole("button", { name: "Go forward" }));
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("2");
    await userEvent.click(monitor.getByRole("combobox"));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Project B" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment Project B" }));
    await expect(canvas.getByRole("status", { name: "Project B count" })).toHaveTextContent("11");
    await waitFor(() => expect(monitor.getByRole("button", { name: "Go back" })).toBeEnabled());
    await userEvent.click(monitor.getByRole("button", { name: "Go back" }));
    await expect(canvas.getByRole("status", { name: "Project B count" })).toHaveTextContent("10");
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("2");
  },
};

export const RegistrationRemovalAndRecovery: Story = {
  render: () => <ReduxMonitorStory />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const monitor = within(canvas.getByRole("region", { name: "Redux monitor" }));
    const options = within(canvasElement.ownerDocument.body);
    await userEvent.click(await monitor.findByRole("combobox"));
    await userEvent.click(await options.findByRole("option", { name: "Project A" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment Project A" }));
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Remove Project A" }));
    await userEvent.click(monitor.getByRole("combobox"));
    await expect(options.queryByRole("option", { name: "Project A" })).toBeNull();
    await userEvent.click(options.getByRole("option", { name: "Project B" }));
    await userEvent.click(canvas.getByRole("button", { name: "Register Project A" }));
    await userEvent.click(monitor.getByRole("combobox"));
    await userEvent.click(await options.findByRole("option", { name: "Project A" }));
    await waitFor(() => expect(monitor.getByRole("button", { name: "Go back" })).toBeEnabled());
    await userEvent.click(monitor.getByRole("button", { name: "Go back" }));
    await expect(canvas.getByRole("status", { name: "Project A count" })).toHaveTextContent("0");
    await expect(canvas.getByRole("status", { name: "Project B count" })).toHaveTextContent("10");
  },
};
