import type { Meta, StoryObj } from "@storybook/react";
import { useState, type JSX } from "react";
import { expect, fn, userEvent, within } from "storybook/test";

import { type IAnnotationAction } from "../../../../shared";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import { AnnotationActionSplitButton } from "../AnnotationActionSplitButton";

const agentAction: IAnnotationAction = {
  displayName: "Pi",
  id: "agent",
  kind: "agent",
  queueEnabled: true,
};

const ticketAction: IAnnotationAction = {
  displayName: "Create Ticket",
  id: "create-ticket",
  kind: "command",
  queueEnabled: false,
};

interface IStoryHarnessProps {
  actions: IAnnotationAction[];
  initialSelectedActionId: string;
  isActionMenuDisabled: boolean;
  isRunDisabled: boolean;
  globals: Partial<Record<string, unknown>>;
  onActionSelect: (actionId: string) => void;
  onRun: () => void;
}

function StoryHarness({
  actions,
  initialSelectedActionId,
  isActionMenuDisabled,
  isRunDisabled,
  globals,
  onActionSelect,
  onRun,
}: IStoryHarnessProps): JSX.Element {
  const [selectedAction, setSelectedAction] = useState<IAnnotationAction>(
    resolveSelectedAction(actions, initialSelectedActionId),
  );

  return (
    <StorybookThemeProvider globals={globals}>
      <AnnotationActionSplitButton
        actions={actions}
        isActionMenuDisabled={isActionMenuDisabled}
        isRunDisabled={isRunDisabled}
        runLabel={selectedAction.displayName}
        selectedAction={selectedAction}
        onActionSelect={(actionId: string): void => {
          setSelectedAction(resolveSelectedAction(actions, actionId));
          onActionSelect(actionId);
        }}
        onRun={onRun}
      />
    </StorybookThemeProvider>
  );
}

function AnnotationActionSplitButtonStory(args: IStoryHarnessProps): JSX.Element {
  return <StoryHarness {...args} />;
}

function resolveSelectedAction(actions: IAnnotationAction[], selectedActionId: string): IAnnotationAction {
  return (
    actions.find((action: IAnnotationAction): boolean => action.id === selectedActionId) ?? actions[0] ?? agentAction
  );
}

const meta: Meta<typeof AnnotationActionSplitButtonStory> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/annotationComposer/components/AnnotationActionSplitButton",
  component: AnnotationActionSplitButtonStory,
  render: (args, context) => {
    return <AnnotationActionSplitButtonStory {...args} globals={context.globals} />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    actions: [agentAction, ticketAction],
    initialSelectedActionId: "agent",
    isActionMenuDisabled: false,
    isRunDisabled: false,
    onActionSelect: fn(),
    onRun: fn(),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await expect(canvas.getByTestId("AnnotationActionSplitButton")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Select annotation action/ }));
    await userEvent.click(page.getByRole("menuitemradio", { name: "Create Ticket" }));

    await expect(args.onActionSelect).toHaveBeenCalledWith("create-ticket");
    await expect(canvas.getByRole("button", { name: "Create Ticket" })).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Create Ticket" }));
    await expect(args.onRun).toHaveBeenCalledTimes(1);
  },
};

/** The action menu portals into the split button, so it stays inside the devtools shadow root with its styles. */
export const MenuStaysInsideShadowRoot: Story = {
  args: {
    actions: [agentAction, ticketAction],
    initialSelectedActionId: "agent",
    isActionMenuDisabled: false,
    isRunDisabled: false,
    onActionSelect: fn(),
    onRun: fn(),
  },
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(<AnnotationActionSplitButtonStory {...args} globals={context.globals} />);
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: /Select annotation action/ }));

    const menu = await shadowCanvas.findByRole("menu");

    await expect(shadowCanvas.getByTestId("AnnotationActionSplitButton")).toContainElement(menu);
    await userEvent.click(within(menu).getByRole("menuitemradio", { name: "Create Ticket" }));

    await expect(args.onActionSelect).toHaveBeenCalledWith("create-ticket");
    await expect(shadowCanvas.getByRole("button", { name: "Create Ticket" })).toBeInTheDocument();
  },
};

export const CanSelectActionWhileRunDisabled: Story = {
  args: {
    actions: [agentAction, ticketAction],
    initialSelectedActionId: "agent",
    isActionMenuDisabled: false,
    isRunDisabled: true,
    onActionSelect: fn(),
    onRun: fn(),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    const runButton = canvas.getByRole("button", { name: "Pi" });
    const menuToggle = canvas.getByRole("button", { name: /Select annotation action/ });

    await expect(runButton).toBeDisabled();
    await expect(menuToggle).toBeEnabled();

    // The toggle continues the disabled run button's hollow outline, so the pair reads as one control. Its chevron
    // keeps a different color because the menu still opens.
    const runButtonStyle: CSSStyleDeclaration = getComputedStyle(runButton);
    const menuToggleStyle: CSSStyleDeclaration = getComputedStyle(menuToggle);

    await expect(menuToggleStyle.backgroundColor).toBe(runButtonStyle.backgroundColor);
    await expect(menuToggleStyle.borderTopStyle).toBe(runButtonStyle.borderTopStyle);
    await expect(menuToggleStyle.borderTopColor).toBe(runButtonStyle.borderTopColor);
    await expect(menuToggleStyle.color).not.toBe(runButtonStyle.color);

    await userEvent.click(menuToggle);
    await userEvent.click(page.getByRole("menuitemradio", { name: "Create Ticket" }));

    await expect(args.onActionSelect).toHaveBeenCalledWith("create-ticket");
    await expect(canvas.getByRole("button", { name: "Create Ticket" })).toBeDisabled();
    await expect(args.onRun).toHaveBeenCalledTimes(0);
  },
};

export const DisabledWhileSubmitting: Story = {
  args: {
    actions: [agentAction, ticketAction],
    initialSelectedActionId: "agent",
    isActionMenuDisabled: true,
    isRunDisabled: true,
    onActionSelect: fn(),
    onRun: fn(),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const runButton = canvas.getByRole("button", { name: "Pi" });
    const menuToggle = canvas.getByRole("button", { name: /Select annotation action/ });

    await expect(runButton).toBeDisabled();
    await expect(menuToggle).toBeDisabled();

    // Both halves are disabled, so the toggle takes the run button's whole treatment, chevron included.
    const runButtonStyle: CSSStyleDeclaration = getComputedStyle(runButton);
    const menuToggleStyle: CSSStyleDeclaration = getComputedStyle(menuToggle);

    await expect(menuToggleStyle.backgroundColor).toBe(runButtonStyle.backgroundColor);
    await expect(menuToggleStyle.borderTopStyle).toBe(runButtonStyle.borderTopStyle);
    await expect(menuToggleStyle.borderTopColor).toBe(runButtonStyle.borderTopColor);
    await expect(menuToggleStyle.color).toBe(runButtonStyle.color);
  },
};
