import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "storybook/test";
import { NativeBrowserConnectionStatus } from "../NativeBrowserConnectionStatus";
import { createNativeBrowserView } from "../../../../shared/nativeBrowser/createNativeBrowserView";
import { factory_nativeBrowserView } from "./fixtures";

const meta: Meta<typeof NativeBrowserConnectionStatus> = {
  title:
    "@alexgorbatchev/devhost-ui/devtools/features/nativeBrowserConnection/components/NativeBrowserConnectionStatus",
  component: NativeBrowserConnectionStatus,
  args: { view: createNativeBrowserView() },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Browser control is disconnected.");
    await expect(
      canvas.getByText(
        "Connect to the browser configured for this project. Native DevTools stays open when you disconnect.",
        { exact: true },
      ),
    ).toBeVisible();
  },
};
export const Connecting: Story = {
  args: { view: { ...createNativeBrowserView(), connectionStatus: "connecting" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Connecting to the configured browser…");
  },
};
export const ExtensionUnverified: Story = {
  args: { view: factory_nativeBrowserView({}) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Browser control is connected.");
    await expect(
      canvas.getByText("React Developer Tools 8.0.0 is missing, disabled, suspended, or unverified in this browser.", {
        exact: true,
      }),
    ).toBeVisible();
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
    await expect(
      within(canvasElement).getByText("The exact project document is not present in the configured browser.", {
        exact: true,
      }),
    ).toBeVisible();
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
    await expect(
      within(canvasElement).getByText(
        "More than one browser page has this exact document identity. No native target was selected.",
        { exact: true },
      ),
    ).toBeVisible();
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
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(
        "React host and extension detected. Open native DevTools, then select Components or Profiler. Live inspection is verified in the native panel.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      canvas.getByText(
        "A native DevTools window is present. Its selected panel and live inspection state are shown there.",
        { exact: true },
      ),
    ).toBeVisible();
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
    await expect(
      within(canvasElement).getByText("The native React session was lost. Inspection recovery remains unverified.", {
        exact: true,
      }),
    ).toBeVisible();
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
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Browser discovery failed. Check the configured loopback endpoint and running dedicated profile.",
    );
    await expect(canvas.getByRole("button", { name: "Copy to clipboard" })).toBeEnabled();
  },
};
export const CompactDisconnected: Story = {
  args: { compact: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Browser disconnected");
  },
};
export const CompactConnecting: Story = {
  args: { compact: true, view: { ...createNativeBrowserView(), connectionStatus: "connecting" } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Browser connecting");
  },
};
export const CompactConnected: Story = {
  args: { compact: true, view: factory_nativeBrowserView({}) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Browser connected");
  },
};
export const CompactSessionLost: Story = {
  args: { compact: true, view: factory_nativeBrowserView({ isNativeSessionLost: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent(
      "Browser connected · native session lost",
    );
  },
};
export const CompactError: Story = {
  args: {
    compact: true,
    view: {
      ...createNativeBrowserView(),
      errorMessage: "Browser discovery failed. Check the configured loopback endpoint and running dedicated profile.",
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Browser disconnected · error");
  },
};
