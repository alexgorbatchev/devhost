import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "storybook/test";

import { ConfigRejectionNotice } from "../ConfigRejectionNotice";
import { fixture_acceptedConfiguration, fixture_rejectedConfiguration } from "./fixtures";

const onEdit = fn();
const meta: Meta<typeof ConfigRejectionNotice> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/configEditor/components/ConfigRejectionNotice",
  component: ConfigRejectionNotice,
  args: { configuration: fixture_rejectedConfiguration, onEdit },
  beforeEach: (): void => {
    onEdit.mockClear();
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const ManifestRejected: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const notice: HTMLElement = within(canvasElement).getByRole("alert");

    await expect(within(canvasElement).getAllByRole("alert")).toHaveLength(1);
    await expect(notice).toHaveTextContent(
      'Manifest change not appliedFailed to parse /home/alex/shop/devhost.toml: toml: line 4 (last key "position"): expected value',
    );
    await userEvent.click(within(notice).getByRole("button", { name: "Edit" }));
    await expect(onEdit).toHaveBeenCalledTimes(1);
  },
};

export const BothRejected: Story = {
  args: {
    configuration: [
      {
        error:
          "devhost config /home/alex/.config/devhost/config.toml is invalid:\ncaddy.httpsPort must be an integer between 1 and 65535.",
        reloads: 2,
        source: "config",
      },
      { error: "Dependency cycle detected: api -> api", reloads: 3, source: "manifest" },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(
      within(canvasElement)
        .getAllByTestId("AlertTitle")
        .map((title) => title.textContent),
    ).toEqual(["devhost config change not applied", "Manifest change not applied"]);
  },
};

export const WithoutTheEditor: Story = {
  args: { onEdit: undefined },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent("Manifest change not applied");
    await expect(within(canvasElement).queryByRole("button", { name: "Edit" })).toBeNull();
  },
};

export const Accepted: Story = {
  args: { configuration: fixture_acceptedConfiguration },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(within(canvasElement).queryByTestId("ConfigRejectionNotice")).toBeNull();
  },
};
