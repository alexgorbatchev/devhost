import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent } from "storybook/test";
import { NativeBrowserConnectionControl } from "../NativeBrowserConnectionControl";
import { createNativeBrowserView } from "../../../../shared/nativeBrowser/createNativeBrowserView";
import { factory_nativeBrowserView } from "./fixtures";
import { NativeBrowserConnectionStatus } from "../NativeBrowserConnectionStatus";
import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "../../../../shared/components/stories/helpers";
import { exerciseNarrowNativeBrowserReadout, renderNarrowNativeBrowserConnection } from "./helpers";

const onConnect = fn(async (): Promise<void> => {});
const onDisconnect = fn();
const onOpen = fn();
const meta: Meta<typeof NativeBrowserConnectionControl> = {
  title:
    "@alexgorbatchev/devhost-ui/devtools/features/nativeBrowserConnection/components/NativeBrowserConnectionControl",
  component: NativeBrowserConnectionControl,
  args: { view: createNativeBrowserView(), statusId: "native-browser-story-status", onConnect, onDisconnect },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar
          position="bottom-right"
          stackName="native-story"
          isMinimapVisible={false}
          collapsedIndicator={<NativeBrowserConnectionStatus view={args.view} compact />}
          readout={
            <>
              <NativeBrowserConnectionControl {...args} />
              <NativeBrowserConnectionStatus view={args.view} id={args.statusId} />
            </>
          }
        >
          {null}
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
  parameters: {
    viewport: {
      options: {
        nativeNarrow: {
          name: "Native browser dock (360 × 480)",
          styles: { width: "360px", height: "480px" },
          type: "mobile",
        },
      },
    },
  },
  beforeEach: () => {
    onConnect.mockClear();
    onDisconnect.mockClear();
    onOpen.mockClear();
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Disconnected: Story = {
  play: async ({ canvasElement }) => {
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(panel.getByRole("status")).toHaveTextContent("Browser control is disconnected.");
    await userEvent.click(panel.getByRole("button", { name: "Connect browser control" }));
    await expect(onConnect).toHaveBeenCalledTimes(1);
    await expect(onDisconnect).not.toHaveBeenCalled();
    await expect(panel.getByRole("button", { name: "Connect browser control" })).not.toHaveAttribute("aria-expanded");
    await expect(panel.queryByRole("button", { name: "Native browser connection" })).toBeNull();
  },
};
export const Connecting: Story = {
  args: { view: { ...createNativeBrowserView(), connectionStatus: "connecting" } },
  play: async ({ canvasElement }) => {
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(panel.getByRole("status")).toHaveTextContent("Connecting to the configured browser…");
    await userEvent.click(panel.getByRole("button", { name: "Disconnect browser control" }));
    await expect(onDisconnect).toHaveBeenCalledTimes(1);
    await expect(onConnect).not.toHaveBeenCalled();
  },
};
export const ExtensionUnverified: Story = {
  args: { view: factory_nativeBrowserView({}) },
  play: async ({ canvasElement }) => {
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
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
    const panel = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(
      panel.getByText(
        "Browser discovery failed. Check the configured loopback endpoint and running dedicated profile.",
        { exact: true },
      ),
    ).toBeVisible();
    await userEvent.click(panel.getByRole("button", { name: "Connect browser control" }));
    await expect(onConnect).toHaveBeenCalledTimes(1);
  },
};

export const NarrowBottomRightDark: Story = {
  args: { view: factory_nativeBrowserView({ isReactAvailable: true, isNativeWindowOpen: true }) },
  globals: { devhostTheme: "dark", viewport: { value: "nativeNarrow", isRotated: false } },
  render: (args, context) => renderNarrowNativeBrowserConnection(args, context.globals, "bottom-right", false, onOpen),
  play: async ({ canvasElement }) => {
    await exerciseNarrowNativeBrowserReadout(canvasElement);
    await expect(onOpen).toHaveBeenCalledTimes(1);
  },
};
export const NarrowTopRightLight: Story = {
  args: { view: factory_nativeBrowserView({ isReactAvailable: true, isNativeWindowOpen: true }) },
  globals: { devhostTheme: "light", viewport: { value: "nativeNarrow", isRotated: false } },
  render: (args, context) => renderNarrowNativeBrowserConnection(args, context.globals, "top-right", true, onOpen),
  play: async ({ canvasElement }) => {
    await exerciseNarrowNativeBrowserReadout(canvasElement);
    await expect(onOpen).toHaveBeenCalledTimes(1);
  },
};
export const NarrowBottomRightLight: Story = {
  args: { view: factory_nativeBrowserView({ isReactAvailable: true, isNativeWindowOpen: true }) },
  globals: { devhostTheme: "light", viewport: { value: "nativeNarrow", isRotated: false } },
  render: (args, context) => renderNarrowNativeBrowserConnection(args, context.globals, "bottom-right", true, onOpen),
  play: async ({ canvasElement }) => {
    await exerciseNarrowNativeBrowserReadout(canvasElement);
    await expect(onOpen).toHaveBeenCalledTimes(1);
  },
};
export const NarrowTopRightDark: Story = {
  args: { view: factory_nativeBrowserView({ isReactAvailable: true, isNativeWindowOpen: true }) },
  globals: { devhostTheme: "dark", viewport: { value: "nativeNarrow", isRotated: false } },
  render: (args, context) => renderNarrowNativeBrowserConnection(args, context.globals, "top-right", false, onOpen),
  play: async ({ canvasElement }) => {
    await exerciseNarrowNativeBrowserReadout(canvasElement);
    await expect(onOpen).toHaveBeenCalledTimes(1);
  },
};
