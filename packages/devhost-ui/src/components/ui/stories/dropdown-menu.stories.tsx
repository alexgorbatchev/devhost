import type { Meta, StoryObj } from "@storybook/react";
import { useState, type JSX } from "react";
import { expect, within } from "storybook/test";

import { Button } from "../button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/stories/DevtoolsStoryShadowRoot";
import { StorybookThemeProvider } from "../../../devtools/shared/stories/storybookTheme";

function OpenDropdownMenuStory(): JSX.Element {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);

  return (
    <div ref={setPortalContainer}>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <Button>Open commands</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent container={portalContainer}>
          <DropdownMenuLabel>Commands</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Restart service
              <DropdownMenuShortcut>R</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">Stop service</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem>View logs</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const meta: Meta<typeof DropdownMenu> = {
  title: "@alexgorbatchev/devhost-ui/components/ui/dropdown-menu",
  component: DropdownMenu,
  render: (_args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <OpenDropdownMenuStory />
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = readDropdownMenuShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByRole("button", { name: "Open commands" })).toBeInTheDocument();
    await expect(shadowCanvas.getByRole("menuitem", { name: /Restart service/ })).toBeInTheDocument();
    await expect(shadowCanvas.getByRole("menuitem", { name: "Stop service" })).toBeInTheDocument();
  },
};

export { Default as DropdownMenu };

function readDropdownMenuShadowCanvas(canvasElement: HTMLElement): ReturnType<typeof within> {
  const canvas = within(canvasElement);
  const hostElement = canvas.getByTestId(devtoolsStoryShadowRootHostTestId);
  const shadowRoot: ShadowRoot = readShadowRoot(hostElement, "DropdownMenu story shadow root was not created.");

  return within(shadowRoot as unknown as HTMLElement);
}
