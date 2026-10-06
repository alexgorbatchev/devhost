import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor } from "storybook/test";

import { ReactHighlightLifecycleScene } from "../../../../.storybook/ReactHighlightLifecycleScene";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
} from "../../shared/components/stories/helpers";

const meta: Meta<typeof ReactHighlightLifecycleScene> = {
  title: "@alexgorbatchev/devhost-ui/devtools/ReactHighlightLifecycle",
  component: ReactHighlightLifecycleScene,
  render: (args) => renderInDevtoolsStoryShadowRoot(<ReactHighlightLifecycleScene {...args} />),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const CursorMessages: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await waitFor(() => expect(canvas.getByLabelText("Connections").textContent).toBe("1"));
    await userEvent.click(canvas.getByRole("button", { name: "Invalid messages" }));
    expect(canvas.getByLabelText("Request count").textContent).toBe("0");
    await userEvent.click(canvas.getByRole("button", { name: "First cursor" }));
    await waitFor(() =>
      expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay").textContent).toBe("src/First.tsx:10:5"),
    );
    expect(canvas.getByLabelText("Highlight requests").textContent).toBe(
      JSON.stringify([{ locator: "src/First.tsx:10:5", projectRootPath: "/message-project" }]),
    );
    const firstOverlay = canvas.getByTestId("ReactHighlightLifecycleScene--overlay");
    await userEvent.click(canvas.getByRole("button", { name: "Second cursor" }));
    await waitFor(() =>
      expect(
        canvas
          .getAllByTestId("ReactHighlightLifecycleScene--overlay")
          .map((element: HTMLElement) => element.textContent),
      ).toEqual(["src/Second.tsx:20:5"]),
    );
    expect(firstOverlay.isConnected).toBe(false);
    await userEvent.click(canvas.getByRole("button", { name: "Invalid messages" }));
    expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay").textContent).toBe("src/Second.tsx:20:5");
    expect(canvas.getByLabelText("Request count").textContent).toBe("2");
    await userEvent.click(canvas.getByRole("button", { name: "Clear cursor" }));
    await waitFor(() => expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull());
    expect(canvas.getByLabelText("Connections").textContent).toBe("1");
    await userEvent.click(canvas.getByRole("button", { name: "Unmount hook" }));
    expect(canvas.getByLabelText("Closed connections").textContent).toBe("1");
  },
};

export const DisabledConnection: Story = {
  args: { initialEnabled: false },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    expect(canvas.getByLabelText("Connections").textContent).toBe("0");
    await userEvent.click(canvas.getByRole("checkbox", { name: "Enabled" }));
    await waitFor(() => expect(canvas.getByLabelText("Connections").textContent).toBe("1"));
    await userEvent.click(canvas.getByRole("button", { name: "First cursor" }));
    await waitFor(() => expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay")).toBeVisible());
    await userEvent.click(canvas.getByRole("checkbox", { name: "Enabled" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Closed connections").textContent).toBe("1");
      expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    });
    await userEvent.click(canvas.getByRole("button", { name: "Old socket message" }));
    expect(canvas.getByLabelText("Request count").textContent).toBe("1");
    expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
  },
};

export const ConnectionChanges: Story = {
  args: { initialToken: "" },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    expect(canvas.getByLabelText("Connections").textContent).toBe("0");
    await userEvent.click(canvas.getByRole("button", { name: "Set token" }));
    await waitFor(() => expect(canvas.getByLabelText("Connections").textContent).toBe("1"));
    await userEvent.click(canvas.getByRole("button", { name: "Cursor with fallback root" }));
    await waitFor(() => expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Rotate token" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Connections").textContent).toBe("2");
      expect(canvas.getByLabelText("Closed connections").textContent).toBe("1");
      expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    });
    await userEvent.click(canvas.getByRole("button", { name: "Old socket message" }));
    expect(canvas.getByLabelText("Request count").textContent).toBe("1");
    await userEvent.click(canvas.getByRole("button", { name: "Switch project" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Connections").textContent).toBe("3");
      expect(canvas.getByLabelText("Closed connections").textContent).toBe("2");
    });
    await userEvent.click(canvas.getByRole("button", { name: "Cursor with fallback root" }));
    await waitFor(() => expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay")).toBeVisible());
    expect(canvas.getByLabelText("Highlight requests").textContent).toBe(
      JSON.stringify([
        { locator: "src/First.tsx:10:5", projectRootPath: "/configured-project" },
        { locator: "src/First.tsx:10:5", projectRootPath: "/other-project" },
      ]),
    );
    const urls: string[] = JSON.parse(canvas.getByLabelText("Socket URLs").textContent ?? "[]");
    expect(urls.map((url) => new URL(url).searchParams.get("token"))).toEqual(["token-one", "token-two", "token-two"]);
    expect(urls.map((url) => new URL(url).host)).toEqual([
      window.location.host,
      window.location.host,
      window.location.host,
    ]);
    await userEvent.click(canvas.getByRole("button", { name: "Clear token" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Connections").textContent).toBe("3");
      expect(canvas.getByLabelText("Closed connections").textContent).toBe("3");
      expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    });
  },
};

export const MissingOverlayRoot: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Toggle overlay root" }));
    await userEvent.click(canvas.getByRole("button", { name: "First cursor" }));
    expect(canvas.getByLabelText("Request count").textContent).toBe("0");
    expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Toggle overlay root" }));
    await userEvent.click(canvas.getByRole("button", { name: "First cursor" }));
    await waitFor(() => expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Unmount hook" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Closed connections").textContent).toBe("3");
      expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    });
  },
};

export const OutOfOrderResults: Story = {
  args: { isDeferred: true },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "First cursor" }));
    await userEvent.click(canvas.getByRole("button", { name: "Second cursor" }));
    expect(canvas.getByLabelText("Request count").textContent).toBe("2");
    expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Resolve second request" }));
    await waitFor(() =>
      expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay").textContent).toBe("src/Second.tsx:20:5"),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Resolve first request" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Resolved requests").textContent).toBe("2");
      expect(
        canvas
          .getAllByTestId("ReactHighlightLifecycleScene--overlay")
          .map((element: HTMLElement) => element.textContent),
      ).toEqual(["src/Second.tsx:20:5"]);
    });
    await userEvent.click(canvas.getByRole("button", { name: "Unmount hook" }));
    await waitFor(() => expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull());
    expect(canvas.getByLabelText("Closed connections").textContent).toBe("1");
  },
};

export const LateResultsAfterCleanup: Story = {
  args: { isDeferred: true },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "First cursor" }));
    await userEvent.click(canvas.getByRole("button", { name: "Unmount hook" }));
    expect(canvas.getByLabelText("Closed connections").textContent).toBe("1");
    await userEvent.click(canvas.getByRole("button", { name: "Resolve first request" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Resolved requests").textContent).toBe("1");
      expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    });
    await userEvent.click(canvas.getByRole("button", { name: "Old socket message" }));
    expect(canvas.getByLabelText("Request count").textContent).toBe("1");
    await userEvent.click(canvas.getByRole("button", { name: "Mount hook" }));
    await userEvent.click(canvas.getByRole("button", { name: "Second cursor" }));
    await userEvent.click(canvas.getByRole("button", { name: "Clear cursor" }));
    await userEvent.click(canvas.getByRole("button", { name: "Resolve second request" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Resolved requests").textContent).toBe("2");
      expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    });
    expect(canvas.getByLabelText("Connections").textContent).toBe("2");
  },
};

export const RemountCleanup: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Unmount hook" }));
    await userEvent.click(canvas.getByRole("button", { name: "Old socket message" }));
    expect(canvas.getByLabelText("Request count").textContent).toBe("0");
    await userEvent.click(canvas.getByRole("button", { name: "Mount hook" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Connections").textContent).toBe("2");
      expect(canvas.getByLabelText("Closed connections").textContent).toBe("1");
    });
    await userEvent.click(canvas.getByRole("button", { name: "First cursor" }));
    await waitFor(() => expect(canvas.getByTestId("ReactHighlightLifecycleScene--overlay")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Unmount hook" }));
    await waitFor(() => {
      expect(canvas.getByLabelText("Closed connections").textContent).toBe("2");
      expect(canvas.queryByTestId("ReactHighlightLifecycleScene--overlay")).toBeNull();
    });
  },
};
