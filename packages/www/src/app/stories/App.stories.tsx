import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { App } from "../App";

const missingReplayPaths: Set<string> = new Set([
  "/recordings/marketing/source-jumps.json",
  "/recordings/marketing/sessions.json",
  "/recordings/marketing/overlay.json",
  "/recordings/marketing/routing-health.json",
]);

type FetchStoryCleanup = () => void;
type StoryRequestInput = RequestInfo | URL;

const meta: Meta<typeof App> = {
  component: App,
  beforeEach(): FetchStoryCleanup {
    const originalFetch: typeof globalThis.fetch = globalThis.fetch;
    const mockedFetch: typeof globalThis.fetch = Object.assign(
      (input: StoryRequestInput, init?: RequestInit): Promise<Response> => {
        const requestUrl = readRequestUrl(input, window.location.href);

        if (missingReplayPaths.has(requestUrl.pathname)) {
          return Promise.resolve(new Response("Not Found", { status: 404 }));
        }

        return originalFetch(input, init);
      },
      {
        preconnect: originalFetch.preconnect,
      },
    );

    globalThis.fetch = mockedFetch;

    return (): void => {
      globalThis.fetch = originalFetch;
    };
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const themeSelect = canvas.getByLabelText("Theme");
    const annotationTab = canvas.getByRole("tab", { name: "Annotation handoff" });
    const sourceNavigationTab = canvas.getByRole("tab", { name: "Source navigation" });
    const routingHealthTab = canvas.getByRole("tab", { name: "Routing + health" });
    const featureSection = canvas.getByRole("region", {
      name: "A routed development surface, not another localhost wrapper.",
    });
    const proofSection = canvas.getByRole("region", {
      name: "The page now sells the real constraints, not decorative abstractions.",
    });

    await expect(
      canvas.getByRole("heading", {
        name: "devhost is the storefront for routed local stacks.",
      }),
    ).toBeInTheDocument();
    await expect(
      within(featureSection).getByRole("heading", { name: "Local HTTPS is a first-class workflow" }),
    ).toBeInTheDocument();
    await expect(
      within(proofSection).queryByRole("heading", { name: "Local HTTPS is a first-class workflow" }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(themeSelect, "light");
    await expect(themeSelect).toHaveValue("light");
    await userEvent.click(annotationTab);
    await expect(annotationTab).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Send annotated page state straight into Pi" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("89 events")).not.toBeInTheDocument();
    await expect(canvas.queryByText("13.2 s capture")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Keyboard controlled")).not.toBeInTheDocument();
    await userEvent.click(sourceNavigationTab);
    await expect(sourceNavigationTab).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("heading", { level: 3, name: "Editor-aware component jumps" })).toBeInTheDocument();
    await userEvent.click(routingHealthTab);
    await expect(routingHealthTab).toHaveAttribute("aria-selected", "true");
    await expect(
      canvas.getByRole("heading", { level: 3, name: "Reserve the host, wait for health, then expose the route" }),
    ).toBeInTheDocument();
  },
};

export { Default as App };

function readRequestUrl(input: StoryRequestInput, baseUrl: string): URL {
  if (typeof input === "string") {
    return new URL(input, baseUrl);
  }

  if (input instanceof URL) {
    return input;
  }

  return new URL(input.url, baseUrl);
}
