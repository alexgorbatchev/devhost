import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ExternalDevtoolsPanel } from "../ExternalDevtoolsPanel";
import { JotaiHarness } from "./fixtures/JotaiHarness";

const meta: Meta<typeof ExternalDevtoolsPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/externalDevtoolsPanel/components/JotaiDevtools",
  component: ExternalDevtoolsPanel,
  render: (_args, context) => <JotaiHarness globals={context.globals} />,
  beforeEach: () => {
    const saved = Object.entries(localStorage).filter(([key]) => key.startsWith("jotai-devtools-"));
    for (const [key] of saved) localStorage.removeItem(key);
    return () => {
      for (const key of Object.keys(localStorage).filter((key) => key.startsWith("jotai-devtools-")))
        localStorage.removeItem(key);
      for (const [key, value] of saved) localStorage.setItem(key, value);
    };
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const CustomStoreLiveHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const launcher = await canvas.findByRole("button", { name: "Jotai 1" });
    const inspector = within(canvas.getByTestId("JotaiHarness--first-inspector"));
    await expect(launcher).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(inspector.getByRole("button", { name: "firstCount" }));
    await expect(inspector.getByText("Raw value", { exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await waitFor(() => expect(inspector.getByTestId("atom-parsed-value")).toHaveTextContent(/^1$/u));
    await userEvent.click(inspector.getByRole("tab", { name: "Time travel" }));
    await userEvent.click(await inspector.findByRole("button", { name: "Record snapshot history" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await inspector.findByRole("button", { name: "1" });
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await inspector.findByRole("button", { name: "2" });
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await inspector.findByRole("button", { name: "3" });
    await userEvent.click(inspector.getByRole("button", { name: "Stop recording snapshot history" }));
    await userEvent.click(inspector.getByTitle("Restore next snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("2"));
    await userEvent.click(inspector.getByTitle("Restore next snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("3"));
    await userEvent.click(inspector.getByTitle("Restore previous snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("2"));
    await userEvent.click(inspector.getByTitle("Start time travel"));
    await waitFor(() => {
      expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("4");
      expect(inspector.getByTitle("Start time travel")).toBeVisible();
    });
    await userEvent.click(inspector.getByRole("button", { name: "2" }));
    await waitFor(() => expect(inspector.getByTitle("Restore this state")).toBeEnabled());
    await userEvent.click(inspector.getByTitle("Restore this state"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("3"));
    await userEvent.click(inspector.getByTitle("Minimize panel"));
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(launcher);
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
  },
};

export const MultipleStores: Story = {
  render: (_args, context) => <JotaiHarness globals={context.globals} hasSecondStore />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = await canvas.findByRole("button", { name: "Jotai 1" });
    const second = await canvas.findByRole("button", { name: "Jotai 2" });
    const inspector = within(canvas.getByTestId("JotaiHarness--second-inspector"));
    await userEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute("aria-pressed", "true"));
    await expect(first).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(inspector.getByRole("button", { name: "secondCount" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment second" }));
    await waitFor(() => expect(inspector.getByTestId("atom-parsed-value")).toHaveTextContent(/^101$/u));
    await expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent("0");
    await userEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "true"));
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "false"));
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(second);
    await waitFor(() => expect(second).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(first);
    const firstInspector = within(canvas.getByTestId("JotaiHarness--first-inspector"));
    await userEvent.click(firstInspector.getByRole("tab", { name: "Time travel" }));
    await userEvent.click(await firstInspector.findByRole("button", { name: "Record snapshot history" }));
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await firstInspector.findByRole("button", { name: "1" });
    await userEvent.click(canvas.getByRole("button", { name: "Increment first" }));
    await firstInspector.findByRole("button", { name: "2" });
    await userEvent.click(firstInspector.getByRole("button", { name: "Stop recording snapshot history" }));
    await userEvent.click(firstInspector.getByTitle("Restore next snapshot"));
    await waitFor(() => expect(canvas.getByRole("status", { name: "first value" })).toHaveTextContent(/^1$/u));
    await expect(canvas.getByRole("status", { name: "second value" })).toHaveTextContent(/^101$/u);
    await userEvent.click(first);
    await waitFor(() => expect(first).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(canvas.getByRole("button", { name: "Remount first inspector" }));
    const replacement = await canvas.findByRole("button", { name: "Jotai 3" });
    await expect(canvas.queryByRole("button", { name: "Jotai 1" })).toBeNull();
    await userEvent.click(replacement);
    await waitFor(() => expect(replacement).toHaveAttribute("aria-pressed", "true"));
    await expect(second).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(replacement);
    await waitFor(() => expect(replacement).toHaveAttribute("aria-pressed", "false"));
    await userEvent.click(canvas.getByRole("button", { name: "Toggle first inspector" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Jotai 3" })).toBeNull());
    await expect(second).toHaveAttribute("aria-pressed", "false");
    await expect(canvas.getByRole("status", { name: "second value" })).toHaveTextContent("101");
  },
};

export const Lifecycle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("button", { name: "Jotai 1" });
    const inspector = within(canvas.getByTestId("JotaiHarness--first-inspector"));
    await userEvent.click(canvas.getByRole("button", { name: "Remount first inspector" }));
    await canvas.findByRole("button", { name: "Jotai 2" });
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).toBeVisible());
    await userEvent.click(inspector.getByTitle("Open Jotai Devtools"));
    await inspector.findByTitle("Minimize panel");
    await userEvent.click(canvas.getByRole("button", { name: "Toggle aggregation" }));
    const launcher = await canvas.findByRole("button", { name: "Jotai 2" });
    await expect(launcher).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(inspector.getByTitle("Minimize panel"));
    await waitFor(() => expect(launcher).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).not.toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Toggle toolbar mount" }));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).toBeVisible());
    await userEvent.click(inspector.getByTitle("Open Jotai Devtools"));
    await inspector.findByTitle("Minimize panel");
    await userEvent.click(inspector.getByTitle("Minimize panel"));
    await waitFor(() => expect(inspector.getByTitle("Open Jotai Devtools")).toBeVisible());
  },
};
