import type { Meta, StoryObj } from "@storybook/react";
import { TriangleAlertIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { DevtoolsToolbar } from "../DevtoolsToolbar";
import { DevtoolsTopLayer } from "../DevtoolsTopLayer";
import { ToolbarPopover } from "../ToolbarPopover";
import { readDevtoolsStoryShadowCanvas, renderDevtoolsInStoryShadowRoot, StorybookThemeProvider } from "./helpers";
import type { DevtoolsPosition } from "../../devtoolsConfig";

const meta: Meta<typeof ToolbarPopover> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/ToolbarPopover",
  component: ToolbarPopover,
};

export default meta;

type Story = StoryObj<typeof meta>;

function renderToolbarWithPopovers(position: DevtoolsPosition, globals: Partial<Record<string, unknown>>) {
  return renderDevtoolsInStoryShadowRoot(
    <StorybookThemeProvider globals={globals}>
      <DevtoolsTopLayer>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position={position} stackName="demo-stack">
          <ToolbarPopover
            panelLabel="Services"
            panelWidth="sm"
            testId="ToolbarPopoverStory--services"
            triggerContent="4/5"
            triggerLabel="Services"
          >
            <p className="px-2 py-1">Services panel body</p>
          </ToolbarPopover>
          <ToolbarPopover
            panelLabel="Annotation queues"
            panelWidth="lg"
            testId="ToolbarPopoverStory--queues"
            triggerContent={
              <>
                <Icon glyph={TriangleAlertIcon} tone="destructive" />
                <span>3</span>
              </>
            }
            triggerLabel="Annotation queues"
            triggerTone="alert"
          >
            <p className="px-2 py-1">Queues panel body</p>
          </ToolbarPopover>
        </DevtoolsToolbar>
      </DevtoolsTopLayer>
    </StorybookThemeProvider>,
  );
}

export const OpensAboveTrigger: Story = {
  render: (_args, context) => renderToolbarWithPopovers("bottom-right", context.globals),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await shadowCanvas.findByRole("button", { name: "Services" });

    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(trigger);

    const panel = await shadowCanvas.findByRole("region", { name: "Services" });

    await waitFor(() => expect(panel).toBeVisible());
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toHaveTextContent("Services panel body");

    const triggerBounds: DOMRect = trigger.getBoundingClientRect();
    const panelBounds: DOMRect = panel.getBoundingClientRect();
    const alignedEdges: boolean[] = [
      Math.round(panelBounds.left) === Math.round(triggerBounds.left),
      Math.round(panelBounds.right) === Math.round(triggerBounds.right),
    ];

    await expect(panelBounds.bottom).toBeLessThanOrEqual(triggerBounds.top);
    // Start-aligned with the trigger, or end-aligned after the flip-inline fallback near the viewport edge.
    await expect(alignedEdges).toContain(true);
    await expect(panelBounds.left).toBeGreaterThanOrEqual(0);
    await expect(panelBounds.right).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const OpensBelowTriggerForTopRightToolbar: Story = {
  render: (_args, context) => renderToolbarWithPopovers("top-right", context.globals),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await shadowCanvas.findByRole("button", { name: "Services" });

    await userEvent.click(trigger);

    const panel = await shadowCanvas.findByRole("region", { name: "Services" });

    await waitFor(() => expect(panel).toBeVisible());
    await expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(trigger.getBoundingClientRect().bottom);
  },
};

export const OnlyOnePanelOpenAtATime: Story = {
  render: (_args, context) => renderToolbarWithPopovers("bottom-right", context.globals),
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const servicesTrigger = await shadowCanvas.findByRole("button", { name: "Services" });
    const queuesTrigger = await shadowCanvas.findByRole("button", { name: "Annotation queues" });

    await userEvent.click(servicesTrigger);
    await waitFor(() => expect(servicesTrigger).toHaveAttribute("aria-expanded", "true"));

    await userEvent.click(queuesTrigger);
    await waitFor(() => expect(queuesTrigger).toHaveAttribute("aria-expanded", "true"));
    await waitFor(() => expect(servicesTrigger).toHaveAttribute("aria-expanded", "false"));
  },
};

// Escape and outside-click light dismiss are browser behaviors that only run for trusted input, which the
// synthetic events from `storybook/test` cannot produce; toggling via the invoking button is covered here.
async function checkPanelClosesInPlace(canvasElement: HTMLElement): Promise<void> {
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const trigger = await shadowCanvas.findByRole("button", { name: "Services" });

  await userEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));

  const panel: HTMLElement = await shadowCanvas.findByRole("region", { name: "Services" });
  await Promise.all(panel.getAnimations().map((animation) => animation.finished));
  const openBounds = panel.getBoundingClientRect();
  const topLayer = shadowCanvas.getByTestId("DevtoolsTopLayer");
  const handleReentry = fn();
  topLayer.addEventListener("beforetoggle", handleReentry);
  // Freeze the browser's real exit transitions halfway through, so geometry is checked during the fade.
  const closingAnimations = new Promise<Animation[]>((resolve) => {
    panel.addEventListener(
      "toggle",
      () => {
        const animations = panel.getAnimations();
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = Number(animation.effect?.getComputedTiming().activeDuration) / 2;
        }
        resolve(animations);
      },
      { once: true },
    );
  });

  await userEvent.click(trigger);

  const animations = await closingAnimations;
  try {
    await expect(animations.length).toBeGreaterThan(0);
    const opacity = Number(getComputedStyle(panel).opacity);
    await expect(opacity).toBeGreaterThan(0);
    await expect(opacity).toBeLessThan(1);
    const closingBounds = panel.getBoundingClientRect();
    await expect(closingBounds.x).toBeCloseTo(openBounds.x);
    await expect(closingBounds.y).toBeCloseTo(openBounds.y);
    await expect(handleReentry).not.toHaveBeenCalled();
  } finally {
    for (const animation of animations) {
      animation.play();
    }
  }

  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "false"));
  await waitFor(() => expect(shadowCanvas.queryByRole("region", { name: "Services" })).toBeNull());
  await waitFor(() => expect(handleReentry).toHaveBeenCalledTimes(2));
  topLayer.removeEventListener("beforetoggle", handleReentry);
}

export const ClosesWhenTriggerClickedAgain: Story = {
  render: (_args, context) => renderToolbarWithPopovers("bottom-right", context.globals),
  play: ({ canvasElement }) => checkPanelClosesInPlace(canvasElement),
};

export const ClosesInPlaceForTopRightToolbar: Story = {
  render: (_args, context) => renderToolbarWithPopovers("top-right", context.globals),
  play: ({ canvasElement }) => checkPanelClosesInPlace(canvasElement),
};
