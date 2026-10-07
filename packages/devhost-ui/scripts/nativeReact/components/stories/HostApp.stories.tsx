import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "storybook/test";
import { HostApp } from "../HostApp";

const meta: Meta<typeof HostApp> = {
  title: "@alexgorbatchev/devhost-ui/scripts/nativeReact/components/HostApp",
  component: HostApp,
  args: { projectName: "A" },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Counter: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Real host A" })).toBeVisible();
    await expect(canvas.getByRole("status", { name: "Host count" })).toHaveTextContent("0");
    await userEvent.click(canvas.getByRole("button", { name: "Increment host A" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment host A" }));
    await expect(canvas.getByRole("status", { name: "Host count" })).toHaveTextContent("2");
  },
};

export const IndependentProjects: Story = {
  render: () => (
    <>
      <section aria-label="Project A">
        <HostApp projectName="A" />
      </section>
      <section aria-label="Project B">
        <HostApp projectName="B" />
      </section>
    </>
  ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const first = within(canvas.getByRole("region", { name: "Project A" }));
    const second = within(canvas.getByRole("region", { name: "Project B" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment host B" }));
    await expect(first.getByRole("status", { name: "Host count" })).toHaveTextContent("0");
    await expect(second.getByRole("status", { name: "Host count" })).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Increment host A" }));
    await expect(first.getByRole("status", { name: "Host count" })).toHaveTextContent("1");
    await expect(second.getByRole("status", { name: "Host count" })).toHaveTextContent("1");
  },
};
