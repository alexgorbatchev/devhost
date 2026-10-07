import type { ComponentProps, JSX } from "react";
import { expect, userEvent, waitFor } from "storybook/test";
import { NativeBrowserConnectionControl } from "../NativeBrowserConnectionControl";
import { NativeBrowserConnectionStatus } from "../NativeBrowserConnectionStatus";
import { ReactNativeAccessButton } from "../../../reactNativeDevtools/components/ReactNativeAccessButton";
import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import type { DevtoolsPosition } from "../../../../shared/devtoolsConfig";
import {
  renderInDevtoolsStoryShadowRoot,
  readDevtoolsStoryShadowCanvas,
  StorybookThemeProvider,
} from "../../../../shared/components/stories/helpers";

export function renderNarrowNativeBrowserConnection(
  args: ComponentProps<typeof NativeBrowserConnectionControl>,
  globals: Partial<Record<string, unknown>>,
  position: DevtoolsPosition,
  isMinimapVisible: boolean,
  onOpen: () => void,
): JSX.Element {
  return renderInDevtoolsStoryShadowRoot(
    <StorybookThemeProvider globals={globals}>
      <DevtoolsToolbar
        position={position}
        stackName="native-story"
        isMinimapVisible={isMinimapVisible}
        collapsedIndicator={<NativeBrowserConnectionStatus view={args.view} compact />}
        readout={
          <>
            <NativeBrowserConnectionControl {...args} />
            <NativeBrowserConnectionStatus view={args.view} id={args.statusId} />
          </>
        }
      >
        <ReactNativeAccessButton
          isAvailable={args.view.observation?.isReactAvailable === true}
          isActionPending={args.view.isActionPending}
          onOpen={onOpen}
        />
      </DevtoolsToolbar>
    </StorybookThemeProvider>,
  );
}

export async function exerciseNarrowNativeBrowserReadout(canvasElement: HTMLElement): Promise<void> {
  const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const readout = canvas.getByRole("region", { name: "Native browser control status" });
  const toolbar = canvas.getByRole("toolbar", { name: "devhost" });
  const viewport = readout.ownerDocument.defaultView;
  await expect(viewport).not.toBeNull();
  await expect(viewport!.innerWidth).toBe(360);
  await expect(viewport!.innerHeight).toBe(480);
  const bounds = readout.getBoundingClientRect();
  await expect(bounds.left).toBeGreaterThanOrEqual(0);
  await expect(bounds.right).toBeLessThanOrEqual(viewport!.innerWidth);
  await expect(bounds.top).toBeGreaterThanOrEqual(0);
  await expect(bounds.bottom).toBeLessThanOrEqual(viewport!.innerHeight);
  await expect(readout.scrollWidth).toBeLessThanOrEqual(readout.clientWidth);
  await expect(canvas.getByTestId("DevtoolsToolbar--bar").getBoundingClientRect().height).toBe(26);
  const command = canvas.getByRole("button", { name: "Disconnect browser control", exact: true });
  await expect(command).toBeVisible();
  const commandBounds = command.getBoundingClientRect();
  await expect(commandBounds.left).toBeGreaterThanOrEqual(0);
  await expect(commandBounds.right).toBeLessThanOrEqual(viewport!.innerWidth);
  await expect(commandBounds.top).toBeGreaterThanOrEqual(0);
  await expect(commandBounds.bottom).toBeLessThanOrEqual(viewport!.innerHeight);
  const reactButton = canvas.getByRole("button", { name: "React DevTools", exact: true });
  await userEvent.click(reactButton);
  await waitFor(async () => {
    await expect(reactButton.getBoundingClientRect().left).toBeGreaterThanOrEqual(toolbar.getBoundingClientRect().left);
    await expect(reactButton.getBoundingClientRect().right).toBeLessThanOrEqual(toolbar.getBoundingClientRect().right);
    await expect(reactButton.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      toolbar.getBoundingClientRect().bottom,
    );
    await expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    const root = reactButton.getRootNode();
    await expect(root).toBeInstanceOf(viewport!.ShadowRoot);
    const hit = (root as ShadowRoot).elementFromPoint(
      reactButton.getBoundingClientRect().left + reactButton.offsetWidth / 2,
      reactButton.getBoundingClientRect().top + reactButton.offsetHeight / 2,
    );
    await expect(hit === reactButton || reactButton.contains(hit)).toBe(true);
  });
  await expect(readout).toHaveTextContent("Browser control is connected.");
  await userEvent.click(canvas.getByRole("button", { name: "Collapse devhost toolbar" }));
  await expect(canvas.queryByRole("region", { name: "Native browser control status" })).toBeNull();
  await expect(canvas.queryByRole("button", { name: "Disconnect browser control" })).toBeNull();
  await expect(canvas.getByRole("status")).toHaveTextContent("Browser connected");
  await userEvent.click(canvas.getByRole("button", { name: "Expand devhost toolbar" }));
  await expect(canvas.getByRole("region", { name: "Native browser control status" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Disconnect browser control" })).toBeEnabled();
}
