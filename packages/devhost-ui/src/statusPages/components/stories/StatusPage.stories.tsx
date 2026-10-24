import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";
import { StatusPage } from "../StatusPage";
import { createStoryClient } from "./helpers";

const meta: Meta<typeof StatusPage> = {
  title: "@alexgorbatchev/devhost-ui/statusPages/components/StatusPage",
  component: StatusPage,
  args: {
    client: createStoryClient(),
    data: {
      kind: "not-found",
      status: 404,
      title: "No active devhost route matched this hostname.",
      message: "Start a stack to register its hostnames.",
      routes: [],
    },
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const EmptyRoutes: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No devhost hostnames are active right now.")).toBeVisible();
    await expect(canvas.queryByRole("link")).toBeNull();
  },
};
export const ActiveRoutes: Story = {
  args: {
    data: {
      kind: "not-found",
      status: 404,
      title: "Route not found",
      message: "Choose an active route.",
      routes: [{ host: "web.localhost", url: "https://web.localhost/path" }],
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(within(canvasElement).getByRole("link", { name: "web.localhost" })).toHaveAttribute(
      "href",
      "https://web.localhost/path",
    );
  },
};
export const Unavailable: Story = {
  args: {
    data: {
      kind: "unavailable",
      status: 502,
      title: "Service unavailable",
      message: "Use devhost to view logs and restart it.",
      routes: [],
    },
  },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(within(canvasElement).getByRole("heading", { level: 1 })).toHaveTextContent("Service unavailable");
    await expect(within(canvasElement).queryByRole("button")).toBeNull();
  },
};
