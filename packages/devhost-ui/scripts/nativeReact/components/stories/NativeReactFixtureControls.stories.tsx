import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { readDevtoolsStoryShadowCanvas } from "../../../../src/devtools/shared/components/stories/helpers";
import { NativeReactFixtureControls } from "../NativeReactFixtureControls";
import { mountNativeReactStoryRoots, readNativeReactStoryControls } from "./helpers";

const meta: Meta<typeof NativeReactFixtureControls> = {
  title: "@alexgorbatchev/devhost-ui/scripts/nativeReact/components/NativeReactFixtureControls",
  component: NativeReactFixtureControls,
  beforeEach: mountNativeReactStoryRoots,
};
export default meta;
type Story = StoryObj<typeof meta>;

const Default: Story = {
  render: () => <NativeReactFixtureControls {...readNativeReactStoryControls()} />,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const roots = within(
      within(canvasElement.ownerDocument.body).getByRole("region", { name: "Native React story roots" }),
    );
    const appContainer = roots.getByTestId("Actual App root container");
    await canvas.findByRole("navigation", { name: "Native fixture lifecycle" });
    await userEvent.click(await roots.findByRole("button", { name: "Increment host Controls" }));
    await expect(roots.getByRole("status", { name: "Host count" })).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Unmount host root" }));
    await expect(roots.queryByRole("main")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Mount host root" }));
    await expect(await roots.findByRole("status", { name: "Host count" })).toHaveTextContent("0");
    const shadow = await readDevtoolsStoryShadowCanvas(appContainer);
    await shadow.findByRole("toolbar", { name: "devhost" });
    await userEvent.click(canvas.getByRole("button", { name: "Disable external tools" }));
    await waitFor(() => expect(shadow.queryByRole("toolbar", { name: "devhost" })).toBeNull());
    await expect(shadow.getByTestId("DevtoolsTopLayer")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Enable external tools" }));
    await expect(await shadow.findByRole("toolbar", { name: "devhost" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Unmount actual App root" }));
    await expect(appContainer).toBeEmptyDOMElement();
    await expect(roots.getByRole("main")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Mount actual App root" }));
    const remounted = await readDevtoolsStoryShadowCanvas(appContainer);
    await expect(await remounted.findByRole("toolbar", { name: "devhost" })).toBeVisible();
    await expect(roots.getByRole("status", { name: "Host count" })).toHaveTextContent("0");
  },
};
export { Default as NativeReactFixtureControls };
