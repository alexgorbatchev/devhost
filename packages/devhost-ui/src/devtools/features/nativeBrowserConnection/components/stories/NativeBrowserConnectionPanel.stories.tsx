import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within, waitFor } from "storybook/test";
import { NativeBrowserConnectionPanel } from "../NativeBrowserConnectionPanel";
import { createNativeBrowserView } from "../../../../shared/nativeBrowser/createNativeBrowserView";
import { factory_nativeBrowserView } from "./fixtures";
import { openNativeBrowserConnectionPanel } from "./helpers";

const onConnect = fn(async (): Promise<void> => {});
const onDisconnect = fn();
const meta: Meta<typeof NativeBrowserConnectionPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/nativeBrowserConnection/components/NativeBrowserConnectionPanel",
  component: NativeBrowserConnectionPanel,
  args: { view: createNativeBrowserView(), onConnect, onDisconnect },
  beforeEach: () => {
    onConnect.mockClear();
    onDisconnect.mockClear();
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(panel.getByRole("status")).toHaveTextContent("Browser control is disconnected.");
    await userEvent.click(panel.getByRole("button", { name: "Connect browser control" }));
    await expect(onConnect).toHaveBeenCalledTimes(1);
    await expect(onDisconnect).not.toHaveBeenCalled();
    // Native light-dismiss requires trusted input; the native acceptance runner covers Escape.
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Native browser connection" }));
    await waitFor(() =>
      expect(within(canvasElement).getByRole("button", { name: "Native browser connection" })).toHaveAttribute(
        "aria-expanded",
        "false",
      ),
    );
  },
};
export const Connecting: Story = {
  args: { view: { ...createNativeBrowserView(), connectionStatus: "connecting" } },
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(panel.getByRole("status")).toHaveTextContent("Connecting to the configured browser…");
    await userEvent.click(panel.getByRole("button", { name: "Disconnect browser control" }));
    await expect(onDisconnect).toHaveBeenCalledTimes(1);
    await expect(onConnect).not.toHaveBeenCalled();
  },
};
export const ExtensionUnverified: Story = {
  args: { view: factory_nativeBrowserView({}) },
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(panel.getByRole("status")).toHaveTextContent("Browser control is connected.");
    await expect(
      panel.getByText("React Developer Tools 8.0.0 is missing, disabled, suspended, or unverified in this browser.", {
        exact: true,
      }),
    ).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Disconnect browser control" }));
    await expect(onDisconnect).toHaveBeenCalledTimes(1);
  },
};
export const UnboundDocument: Story = {
  args: {
    view: factory_nativeBrowserView({
      documentState: "unbound",
      message: "The exact project document is not present in the configured browser.",
    }),
  },
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(
      panel.getByText("The exact project document is not present in the configured browser.", { exact: true }),
    ).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Disconnect browser control" }));
    await expect(onDisconnect).toHaveBeenCalledTimes(1);
  },
};
export const AmbiguousDocument: Story = {
  args: {
    view: factory_nativeBrowserView({
      documentState: "ambiguous",
      message: "More than one browser page has this exact document identity. No native target was selected.",
    }),
  },
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(
      panel.getByText("More than one browser page has this exact document identity. No native target was selected.", {
        exact: true,
      }),
    ).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Disconnect browser control" }));
    await expect(onDisconnect).toHaveBeenCalledTimes(1);
  },
};
export const NativeWindowPresent: Story = {
  args: {
    view: factory_nativeBrowserView({
      isReactAvailable: true,
      isNativeWindowOpen: true,
      message:
        "React host and extension detected. Open native DevTools, then select Components or Profiler. Live inspection is verified in the native panel.",
    }),
  },
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(
      panel.getByText(
        "A native DevTools window is present. Its selected panel and live inspection state are shown there.",
        { exact: true },
      ),
    ).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Disconnect browser control" }));
    await expect(onDisconnect).toHaveBeenCalledTimes(1);
  },
};
export const NativeSessionLost: Story = {
  args: {
    view: factory_nativeBrowserView({
      isNativeSessionLost: true,
      message: "The native React session was lost. Inspection recovery remains unverified.",
    }),
  },
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(
      panel.getByText("The native React session was lost. Inspection recovery remains unverified.", { exact: true }),
    ).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Disconnect browser control" }));
    await expect(onDisconnect).toHaveBeenCalledTimes(1);
  },
};
export const ConnectionError: Story = {
  args: {
    view: {
      ...createNativeBrowserView(),
      errorMessage: "Browser discovery failed. Check the configured loopback endpoint and running dedicated profile.",
    },
  },
  play: async ({ canvasElement }) => {
    const panel = await openNativeBrowserConnectionPanel(canvasElement);
    await expect(
      within(canvasElement).getByText(
        "Browser discovery failed. Check the configured loopback endpoint and running dedicated profile.",
        { exact: true },
      ),
    ).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Connect browser control" }));
    await expect(onConnect).toHaveBeenCalledTimes(1);
  },
};
