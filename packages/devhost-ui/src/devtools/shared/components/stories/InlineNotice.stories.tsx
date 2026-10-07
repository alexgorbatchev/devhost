import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor } from "storybook/test";

import { InlineNotice } from "../InlineNotice";
import { readDevtoolsStoryShadowCanvas, renderInDevtoolsStoryShadowRoot } from "./helpers";
import { StorybookThemeProvider } from "./helpers";

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
