import { act, render, type RenderResult } from "@testing-library/react";
import { waitForAnimationFrame } from "../../../../test-support/hostPageUtils";

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
  return renderResponsiveToolbar({
    ...props,
    readout: "A readout long enough to wrap inside the toolbar's narrow layout. ".repeat(48),
  });
}
