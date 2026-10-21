import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { Card } from "../../../../components/ui/Card";
import { InlineNotice } from "../InlineNotice";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot } from "./helpers";
import { StorybookThemeProvider } from "./helpers";
import { readContrastRatio } from "../../../../../../../test-support/readContrastRatio";

const meta: Meta<typeof InlineNotice> = {
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/InlineNotice",
  component: InlineNotice,
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <InlineNotice {...args} />
      </StorybookThemeProvider>,
    );
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    action: <button type="button">Retry</button>,
    children: "Service health is unavailable.",
    title: "Connection failed",
    tone: "danger",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(shadowCanvas.getByRole("alert")).toHaveTextContent("Connection failed");
    await expect(shadowCanvas.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    // The message reads below its title, starting at the same edge, rather than continuing the title's line.
    const title = shadowCanvas.getByTestId("AlertTitle").getBoundingClientRect();
    const description = shadowCanvas.getByTestId("AlertDescription").getBoundingClientRect();
    await expect(description.top).toBeGreaterThanOrEqual(title.bottom);
    await expect(description.left).toBe(title.left);
  },
};

// An error message must call for attention: its strip stands out from the panel it sits in, and its text stays
// clearly readable on that strip, in either theme.
export const DangerDark: Story = {
  args: {
    children: "Failed to restart stack: TypeError: Failed to fetch",
    title: "Stack restart failed",
    tone: "danger",
  },
  globals: { devhostTheme: "dark" },
  render: (args, context) => {
    return renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <Card>
          <InlineNotice {...args} />
        </Card>
      </StorybookThemeProvider>,
    );
  },
  play: async ({ canvasElement }): Promise<void> => {
    await expectErrorNoticeToStandOut(canvasElement);
  },
};

export const DangerLight: Story = {
  ...DangerDark,
  globals: { devhostTheme: "light" },
  play: async ({ canvasElement }): Promise<void> => {
    await expectErrorNoticeToStandOut(canvasElement);
  },
};

export const Copyable: Story = {
  args: {
    children: "Could not reach devhost at http://127.0.0.1:4000.",
    title: "Restart failed",
    tone: "danger",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const writeText = fn().mockResolvedValue(undefined);
    const restore = stubClipboard({ writeText });

    try {
      const copyButton = shadowCanvas.getByTestId("InlineNotice--copy");
      await expect(copyButton).toHaveAccessibleName("Copy to clipboard");
      await expect(copyButton).toHaveAttribute("title", "Copy to clipboard");

      await userEvent.click(copyButton);

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      await expect(writeText).toHaveBeenCalledWith(
        "Restart failed\n\nCould not reach devhost at http://127.0.0.1:4000.",
      );
      await waitFor(() => expect(shadowCanvas.getByTestId("InlineNotice--copy")).toHaveAccessibleName("Copied"));
    } finally {
      restore();
    }
  },
};

export const CopyError: Story = {
  args: {
    children: "Could not reach devhost at http://127.0.0.1:4000.",
    title: "Restart failed",
    tone: "danger",
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const restore = stubClipboard(undefined);

    try {
      await userEvent.click(shadowCanvas.getByTestId("InlineNotice--copy"));

      await waitFor(() =>
        expect(shadowCanvas.getByTestId("InlineNotice--copy-error")).toHaveTextContent(
          "Clipboard unavailable (requires a secure context: https or localhost).",
        ),
      );
      await expect(shadowCanvas.getByTestId("InlineNotice--copy")).toHaveAccessibleName(
        /Copy failed: Clipboard unavailable/,
      );
    } finally {
      restore();
    }
  },
};

export const Dismissible: Story = {
  args: {
    children: "Queue connection lost. Retrying…",
    onDismiss: fn(),
    tone: "danger",
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Dismiss" }));
    await expect(args.onDismiss).toHaveBeenCalledTimes(1);
  },
};

// WCAG 2.2 minimums: 4.5:1 for text (1.4.3) and 3:1 for a component against its surroundings (1.4.11).
async function expectErrorNoticeToStandOut(canvasElement: HTMLElement): Promise<void> {
  const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
  const notice = shadowCanvas.getByRole("alert");

  await expect(
    readContrastRatio(notice, { property: "backgroundColor", useParentBackground: true }),
  ).toBeGreaterThanOrEqual(3);
  await expect(readContrastRatio(shadowCanvas.getByTestId("AlertTitle"))).toBeGreaterThanOrEqual(4.5);
  await expect(readContrastRatio(shadowCanvas.getByTestId("AlertDescription"))).toBeGreaterThanOrEqual(4.5);
}

interface IClipboardStub {
  writeText: (value: string) => Promise<void>;
}

type RestoreClipboard = () => void;

function stubClipboard(replacement: IClipboardStub | undefined): RestoreClipboard {
  const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    get: () => replacement,
  });
  return () => {
    Reflect.deleteProperty(navigator, "clipboard");
    if (descriptor !== undefined) {
      Object.defineProperty(Navigator.prototype, "clipboard", descriptor);
    }
  };
}
