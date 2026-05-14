import type { Meta, StoryObj } from "@storybook/react";
import { useState, type JSX } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { Button } from "../button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import {
  devtoolsStoryShadowRootHostTestId,
  readShadowRoot,
  renderInDevtoolsStoryShadowRoot,
} from "../../../devtools/shared/components/stories/helpers";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";

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
            <DropdownMenuItem inset>Open dashboard</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>Show hidden services</DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="tail">
              <DropdownMenuRadioItem value="tail">Tail logs</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="archive">Archived logs</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>More actions</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Copy service URL</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
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
    await expect(shadowCanvas.getByRole("menuitem", { name: "Open dashboard" })).toBeInTheDocument();
    await expect(shadowCanvas.getByRole("menuitemcheckbox", { name: "Show hidden services" })).toBeChecked();
    await expect(shadowCanvas.getByRole("menuitemradio", { name: "Tail logs" })).toBeChecked();
    const moreActionsItem = shadowCanvas.getByRole("menuitem", { name: "More actions" });

    await userEvent.hover(moreActionsItem);
    await waitFor(() => {
      expect(moreActionsItem).toHaveAttribute("aria-expanded", "true");
    });
    await expect(shadowCanvas.getByRole("menuitem", { name: "Copy service URL" })).toBeInTheDocument();
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
