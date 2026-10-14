import { act, render, type RenderResult } from "@testing-library/react";
import { waitForAnimationFrame } from "../../../../test-support/hostPageUtils";
import { NativeBrowserConnectionControl } from "../../features/nativeBrowserConnection/components/NativeBrowserConnectionControl";
import { NativeBrowserConnectionStatus } from "../../features/nativeBrowserConnection/components/NativeBrowserConnectionStatus";
import { createNativeBrowserView } from "../nativeBrowser/createNativeBrowserView";

import {
  ResponsiveToolbarScene,
  renderInDevtoolsStoryShadowRoot,
  type IResponsiveToolbarProps,
} from "../components/stories/helpers";

type ToolbarChange = () => Promise<unknown> | void;

export async function settleToolbar(change: ToolbarChange): Promise<void> {
  await act(async () => {
    await change();
    await waitForAnimationFrame();
    await waitForAnimationFrame();
  });
}

export async function renderResponsiveToolbar(props: IResponsiveToolbarProps): Promise<RenderResult> {
  const view = render(renderInDevtoolsStoryShadowRoot(<ResponsiveToolbarScene {...props} />));
  await settleToolbar(() => {});
  return view;
}

export async function renderResponsiveToolbarWithReadout(props: IResponsiveToolbarProps): Promise<RenderResult> {
  const view = {
    ...createNativeBrowserView(),
    errorMessage:
      "Browser discovery failed. Check the configured loopback endpoint and running dedicated profile. ".repeat(8),
  };
  return renderResponsiveToolbar({
    ...props,
    readout: (
      <>
        <NativeBrowserConnectionControl
          view={view}
          onConnect={async () => {}}
          onDisconnect={() => {}}
          statusId="mobile-browser-status"
        />
        <NativeBrowserConnectionStatus view={view} id="mobile-browser-status" />
      </>
    ),
  });
}
