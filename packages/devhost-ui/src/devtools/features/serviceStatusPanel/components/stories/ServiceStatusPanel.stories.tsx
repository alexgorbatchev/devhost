import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { RESTART_SERVICE_PATH } from "../../../../shared";
import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import { storybookDevtoolsThemeGlobalName } from "../../../../shared/storybookTheme";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import {
  exerciseHealthPollErrorContrast,
  ServiceHealthUpdatesHarness,
  StoppedServicesPanelHarness,
  WorktreePanelHarness,
} from "./helpers";
import { factory_worktreeRepository, fixture_healthPollErrorServices, fixture_stoppedServices } from "./fixtures";

const meta: Meta<typeof WorktreePanelHarness> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/serviceStatusPanel/components/ServiceStatusPanel",
  component: WorktreePanelHarness,
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <WorktreePanelHarness {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "api", status: true },
      { managed: false, name: "worker", status: false },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 1 of 2 up" }));

    const panel = await shadowCanvas.findByRole("region", { name: "Services" });

    await waitFor(() => expect(panel).toBeVisible());
    await expect(shadowCanvas.queryByRole("list", { name: "Applications" })).toBeNull();
    await expect(within(panel).getByRole("list", { name: "Services" })).toBeVisible();
    await expect(shadowCanvas.getByText("external")).toBeVisible();
    await expect(shadowCanvas.queryByText("managed")).toBeNull();
    await expect(shadowCanvas.queryByRole("button", { name: "Restart worker" })).toBeNull();

    const restartFetch = fn(async () => new Response(null, { status: 204 }));
    const originalFetch = globalThis.fetch;

    Reflect.set(globalThis, "fetch", restartFetch);

    try {
      await userEvent.click(shadowCanvas.getByRole("button", { name: "Restart api" }));

      await expect(restartFetch).toHaveBeenCalledWith(
        RESTART_SERVICE_PATH,
        expect.objectContaining({
          body: JSON.stringify({ serviceNames: ["api"] }),
          headers: expect.objectContaining({
            "content-type": "application/json",
          }),
          method: "POST",
        }),
      );
      await userEvent.click(shadowCanvas.getByRole("button", { name: "Restart Stack" }));
      await expect(restartFetch).toHaveBeenLastCalledWith("/__devhost__/restart-stack", {
        method: "POST",
      });
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};

export const RestartChanged: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "api", status: true, dirty: true },
      { managed: true, name: "web", status: true, dirty: true },
      { managed: true, name: "worker", status: true },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 3 of 3 up, 2 changed" }));
    const changed = await canvas.findByRole("button", { name: "Restart Changed" });
    const stack = canvas.getByRole("button", { name: "Restart Stack" });
    await waitFor(() => expect(changed).toBeVisible());
    await expect(within(changed).getByText("Alt+Ctrl+R")).toBeVisible();
    const changedBounds = changed.getBoundingClientRect();
    const stackBounds = stack.getBoundingClientRect();
    const rowBounds = stack.parentElement!.getBoundingClientRect();
    await expect(changedBounds.width).toBeGreaterThan(stackBounds.width);
    await expect(changedBounds.left).toBeGreaterThan(rowBounds.left);
    await expect(stackBounds.right).toBeCloseTo(rowBounds.right, 0);
    await expect(stack.querySelector("svg")).toBeNull();
    await expect(stackBounds.left).toBeGreaterThan(changedBounds.right);
    const shortcut = within(changed).getByText("Alt+Ctrl+R");
    const shortcutBounds = shortcut.getBoundingClientRect();
    const label = changed.ownerDocument.createRange();
    label.selectNodeContents(changed.childNodes[0]);
    const labelBounds = label.getBoundingClientRect();
    await expect(
      Math.abs(labelBounds.top + labelBounds.height / 2 - shortcutBounds.top - shortcutBounds.height / 2),
    ).toBeLessThan(2);
    await expect(changed.scrollWidth).toBeLessThanOrEqual(changed.clientWidth);
    await expect(stack.scrollWidth).toBeLessThanOrEqual(stack.clientWidth);
    const request = fn(async () => new Response(null, { status: 204 }));
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis, "fetch", request);
    try {
      await userEvent.click(changed);
      await expect(request).toHaveBeenCalledWith(
        RESTART_SERVICE_PATH,
        expect.objectContaining({
          body: JSON.stringify({ serviceNames: ["api", "web"] }),
          method: "POST",
        }),
      );
      await userEvent.hover(stack);
      await expect(stack).toHaveAttribute("title", "Restarts all managed services and reassigns automatic ports.");
      await expect(canvas.queryByRole("button", { name: "About Restart Stack" })).toBeNull();
      await expect(changed).toBeVisible();
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};

export const ChangedService: Story = {
  args: {
    errorMessage: null,
    services: [
      { dirty: true, managed: true, name: "api", status: true },
      { managed: true, name: "web", status: true },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await shadowCanvas.findByRole("button", { name: "Services: 2 of 2 up, 1 changed" });

    await expect(trigger).toHaveTextContent("1 changed");
    const reload = await shadowCanvas.findByRole("button", { name: "Restart changed services", exact: true });
    const triggerBounds = trigger.getBoundingClientRect();
    const reloadBounds = reload.getBoundingClientRect();
    await expect(reloadBounds.left).toBeCloseTo(triggerBounds.right, 0);
    await expect(reloadBounds.top + reloadBounds.height / 2).toBeCloseTo(
      triggerBounds.top + triggerBounds.height / 2,
      0,
    );
    const request = fn(async () => new Response(null, { status: 204 }));
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis, "fetch", request);
    try {
      await userEvent.click(reload);
      await expect(request).toHaveBeenCalledWith(
        RESTART_SERVICE_PATH,
        expect.objectContaining({ body: JSON.stringify({ serviceNames: ["api"] }), method: "POST" }),
      );
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
    } finally {
      Reflect.set(globalThis, "fetch", originalFetch);
    }
    await userEvent.click(trigger);
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("button", { name: "Restart api" })).toBeEnabled();
  },
};

export const RestartingService: Story = {
  args: {
    errorMessage: null,
    services: [{ managed: true, name: "api", restarting: true, status: true }],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 1 of 1 up" }));
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("button", { name: "Restart api" })).toBeDisabled();
    await expect(shadowCanvas.getByRole("button", { name: "Restart Stack" })).toBeDisabled();
  },
};

export const ToolbarRestartFailure: Story = {
  args: ChangedService.args,
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const pending = Promise.withResolvers<Response>();
    const request = fn(() => pending.promise);
    const originalFetch = globalThis.fetch;
    Reflect.set(globalThis, "fetch", request);
    try {
      const reload = await canvas.findByRole("button", { name: "Restart changed services", exact: true });
      await userEvent.click(reload);
      await expect(reload).toBeDisabled();
      await userEvent.click(canvas.getByRole("button", { name: "Services: 2 of 2 up, 1 changed" }));
      await waitFor(() => expect(canvas.getByRole("region", { name: "Services" })).toBeVisible());
      await expect(await canvas.findByRole("button", { name: "Restart Stack" })).toBeDisabled();
      await expect(canvas.getByRole("button", { name: "Restart api", exact: true })).toBeDisabled();
      pending.resolve(new Response("busy", { status: 409 }));
      await waitFor(() => expect(canvas.getByText("Failed to restart api: busy")).toBeVisible());
      await userEvent.click(canvas.getByRole("button", { name: "Dismiss", exact: true }));
      await expect(await canvas.findByRole("button", { name: "Restart changed services", exact: true })).toBeEnabled();
    } finally {
      pending.resolve(new Response(null, { status: 204 }));
      Reflect.set(globalThis, "fetch", originalFetch);
    }
  },
};

export const ToolbarRestartBlocked: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "api", status: true, dirty: true },
      { managed: true, name: "web", status: true, restarting: true },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Restart changed services", exact: true })).toBeDisabled();
  },
};

export const ChangedExternalService: Story = {
  args: {
    errorMessage: null,
    services: [{ managed: false, name: "external", status: true, dirty: true }],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Restart changed services", exact: true })).toBeDisabled();
  },
};

export const WithLinks: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "web", status: true, url: "http://localhost:3000" },
      { managed: false, name: "docs", status: true, url: "http://localhost:3001" },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 2 of 2 up" }));
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("link", { name: "web" })).toHaveAttribute("href", "http://localhost:3000");
    await expect(shadowCanvas.queryByRole("button", { name: "Restart docs" })).toBeNull();
    const applications = shadowCanvas.getByRole("list", { name: "Applications" });
    await expect(
      within(applications)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["docs", "web"]);
    await expect(shadowCanvas.queryByRole("list", { name: "Services" })).toBeNull();
  },
};

export const ApplicationsAndServices: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "web", status: true, url: "https://web.localhost" },
      { managed: false, name: "worker", status: false },
      { managed: true, name: "api", status: false, url: "https://api.localhost" },
      { managed: true, name: "cache", status: true, dirty: true },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 2 of 4 up, 1 changed" }));
    const panel = await canvas.findByRole("region", { name: "Services" });
    await waitFor(() => expect(panel).toBeVisible());
    const lists = within(panel).getAllByRole("list");
    await expect(lists.map((list) => list.getAttribute("aria-label"))).toEqual(["Applications", "Services"]);
    const applications = within(canvas.getByRole("list", { name: "Applications" }));
    await expect(applications.getAllByRole("link").map((link) => link.textContent)).toEqual(["api", "web"]);
    const services = within(canvas.getByRole("list", { name: "Services" }));
    await expect(
      services.getAllByRole("listitem").map((row) => within(row).getByText(/^(cache|worker)$/).textContent),
    ).toEqual(["cache", "worker"]);
    await expect(applications.getByRole("link", { name: "api" })).toHaveAttribute("target", "_blank");
    await expect(services.getByText("changed")).toBeVisible();
    await expect(services.queryByRole("button", { name: "Restart worker" })).toBeNull();
  },
};

export const LightApplicationsAndServices: Story = {
  ...ApplicationsAndServices,
  globals: { [storybookDevtoolsThemeGlobalName]: "light" },
  play: ApplicationsAndServices.play,
};

export const NumberedServiceNames: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "worker10", status: true },
      { managed: true, name: "Worker2", status: false },
      { managed: true, name: "worker1", status: true },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 2 of 3 up" }));
    const list = await canvas.findByRole("list", { name: "Services" });
    await waitFor(() => expect(list).toBeVisible());
    await expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Restart worker1", "Restart Worker2", "Restart worker10"]);
  },
};

export const HealthUpdatesKeepOrder: Story = {
  args: ApplicationsAndServices.args,
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <ServiceHealthUpdatesHarness {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 2 of 4 up, 1 changed" }));
    const panel = await canvas.findByRole("region", { name: "Services" });
    await waitFor(() => expect(panel).toBeVisible());
    await expect(
      within(canvas.getByRole("list", { name: "Applications" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["api", "web"]);
    await userEvent.click(canvas.getByRole("button", { name: "Update service health" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 2 of 4 up" }));
    await waitFor(() => expect(panel).toBeVisible());
    const applications = within(canvas.getByRole("list", { name: "Applications" }));
    await expect(applications.getAllByRole("link").map((link) => link.textContent)).toEqual(["api", "web"]);
    await expect(
      applications.getAllByRole("listitem").map((row) => within(row).getByText(/^(up|down)$/).textContent),
    ).toEqual(["up", "down"]);
    const services = within(canvas.getByRole("list", { name: "Services" }));
    await expect(
      services.getAllByRole("listitem").map((row) => within(row).getByText(/^(cache|worker)$/).textContent),
    ).toEqual(["cache", "worker"]);
    await expect(services.queryByText("changed")).toBeNull();
  },
};

export const WithErrorMessage: Story = {
  args: {
    errorMessage: "Connection to devhost lost",
    onSetErrorMessage: fn(),
    services: [],
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await shadowCanvas.findByRole("button", { name: "Services: 0 of 0 up, error" }));
    await waitFor(() => expect(shadowCanvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(shadowCanvas.getByRole("alert")).toHaveTextContent("Connection to devhost lost");

    await userEvent.click(shadowCanvas.getByRole("button", { name: "Dismiss" }));
    await expect(args.onSetErrorMessage).toHaveBeenCalledWith(null);
  },
};

export const Empty: Story = {
  args: {
    errorMessage: null,
    services: [],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const shadowCanvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await expect(await shadowCanvas.findByRole("toolbar", { name: "devhost" })).toBeVisible();
    await expect(shadowCanvas.queryByRole("button", { name: /^Services/ })).toBeNull();
  },
};

export const HealthPollErrorWithServices: Story = {
  args: fixture_healthPollErrorServices,
  globals: { [storybookDevtoolsThemeGlobalName]: "dark" },
  play: async ({ args, canvasElement }): Promise<void> => {
    await exerciseHealthPollErrorContrast(canvasElement, args);
  },
};

export const LightHealthPollErrorWithServices: Story = {
  args: fixture_healthPollErrorServices,
  globals: { [storybookDevtoolsThemeGlobalName]: "light" },
  play: async ({ args, canvasElement }): Promise<void> => {
    await exerciseHealthPollErrorContrast(canvasElement, args);
  },
};

export const WithStoppedServices: Story = {
  args: {
    errorMessage: null,
    services: [{ managed: true, name: "web", status: true }],
    stoppedServices: fixture_stoppedServices.slice(0, 2),
    onStartServices: fn(async () => null),
  },
  render: (args, context) =>
    renderInDevtoolsStoryShadowRoot(
      <StorybookThemeProvider globals={context.globals}>
        <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="demo">
          <StoppedServicesPanelHarness {...args} />
        </DevtoolsToolbar>
      </StorybookThemeProvider>,
    ),
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    // Stopped services are not counted among the running ones.
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 1 of 1 up" }));
    await waitFor(() => expect(canvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(canvas.queryByRole("button", { name: "Start docs" })).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "Stopped services (2)" }));
    await waitFor(() => expect(canvas.getByRole("region", { name: "Stopped services" })).toBeVisible());
    await expect(canvas.queryByRole("button", { name: "Restart web" })).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "Back to services" }));
    await waitFor(() => {
      const opener = canvas.getByRole("button", { name: "Stopped services (2)" });
      expect(Reflect.get(opener.getRootNode(), "activeElement")).toBe(opener);
    });

    await userEvent.click(canvas.getByRole("button", { name: "Stopped services (2)" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Start docs" }));
    await expect(args.onStartServices).toHaveBeenCalledWith(["docs"]);
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Start docs" })).toBeNull());
    await expect(canvas.getByRole("button", { name: "Start admin" })).toBeEnabled();

    // Starting the last stopped service returns to the services, where both now run.
    await userEvent.click(canvas.getByRole("button", { name: "Start admin" }));
    await waitFor(() => expect(canvas.getByRole("region", { name: "Services" })).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Services: 3 of 3 up" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Restart docs" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Restart admin" })).toBeEnabled();
    await expect(canvas.queryByRole("button", { name: /^Stopped services/ })).toBeNull();
  },
};

export const StoppedServicesWhileRestarting: Story = {
  args: {
    errorMessage: null,
    services: [{ managed: true, name: "web", restarting: true, status: true }],
    stoppedServices: fixture_stoppedServices,
    onStartServices: fn(async () => null),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);

    await userEvent.click(await canvas.findByRole("button", { name: "Services: 1 of 1 up" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Stopped services (3)" }));
    const start = await canvas.findByRole("button", { name: "Start docs" });
    await waitFor(() => expect(start).toBeVisible());
    await expect(start).toBeDisabled();
    await expect(args.onStartServices).not.toHaveBeenCalled();
  },
};

export const GroupedServices: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "web", status: true, dirty: true, url: "https://web.localhost" },
      { managed: true, name: "api", status: true, url: "https://api.localhost" },
      { managed: true, name: "worker", status: true },
      { managed: false, name: "postgres", status: true },
    ],
    repositories: [factory_worktreeRepository(["web", "api", "worker"])],
    onRefreshWorktrees: fn(async () => null),
    onSwitchWorktree: fn(async () => null),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 4 of 4 up, 1 changed" }));
    await waitFor(() => expect(canvas.getByRole("region", { name: "shop repository" })).toBeVisible());
    const repository = within(canvas.getByRole("region", { name: "shop repository" }));
    await expect(repository.getAllByRole("list").map((list) => list.getAttribute("aria-label"))).toEqual([
      "Applications",
      "Services",
    ]);
    await expect(
      within(repository.getByRole("list", { name: "Applications" }))
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["api", "web"]);
    await expect(repository.queryByRole("button", { name: /^Worktrees/ })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Worktrees" }));
    const feature = canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(feature).toBeEnabled());
    await userEvent.click(feature);
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart stack" }));
    await expect(args.onSwitchWorktree).toHaveBeenCalledWith("shop", "/worktrees/cart");
    await waitFor(() => expect(canvas.getByRole("button", { name: /^Worktrees/ })).toHaveTextContent("feature/cart"));
    await expect(canvas.getByRole("button", { name: "Services: 4 of 4 up, 1 changed" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toBeVisible();
    await expect(
      canvas.getByRole("button", {
        name: "Worktrees, non-default branches: shop: feature/cart",
      }),
    ).toHaveAttribute("title", "Worktrees, non-default branches: shop: feature/cart");
  },
};

export const GroupedServicesWhileSwitching: Story = {
  args: {
    ...GroupedServices.args,
    repositories: [{ ...factory_worktreeRepository(["web", "api", "worker"]), switching: true }],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Services: 4 of 4 up, 1 changed" }));
    const repository = await canvas.findByRole("region", { name: "shop repository" });
    await waitFor(() => expect(repository).toBeVisible());
    const applications = within(within(repository).getByRole("list", { name: "Applications" }));
    await expect(applications.getByRole("button", { name: "Restart api" })).toBeDisabled();
    await expect(applications.getByRole("button", { name: "Restart web" })).toBeDisabled();
    const services = within(within(repository).getByRole("list", { name: "Services" }));
    await expect(services.getByRole("button", { name: "Restart worker" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Restart Stack" })).toBeDisabled();
  },
};

export const SingleManagedServiceWithWorktrees: Story = {
  args: {
    errorMessage: null,
    services: [{ managed: true, name: "web", status: true }],
    repositories: [factory_worktreeRepository(["web"])],
    onRefreshWorktrees: fn(async () => null),
    onSwitchWorktree: fn(async () => null),
  },
  play: async ({ args, canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    const feature = canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(feature).toBeEnabled());
    await userEvent.click(feature);
    await expect(canvas.getByRole("button", { name: "Switch and restart stack" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(args.onSwitchWorktree).not.toHaveBeenCalled();
    await waitFor(() => {
      const button = canvas.getByRole("button", { name: /^Worktrees/ });
      expect(Reflect.get(button.getRootNode(), "activeElement")).toBe(button);
    });
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toHaveTextContent("main");
  },
};

export const CustomDefaultBranch: Story = {
  args: {
    errorMessage: null,
    services: [{ managed: true, name: "web", status: true }],
    repositories: [factory_worktreeRepository(["web"], "trunk")],
    onRefreshWorktrees: fn(async () => null),
    onSwitchWorktree: fn(async () => null),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Worktrees" });
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toBeVisible();
    await userEvent.click(trigger);
    const feature = canvas.getByRole("radio", { name: "feature/cart /worktrees/cart" });
    await waitFor(() => expect(feature).toBeEnabled());
    await userEvent.click(feature);
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart stack" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: /^Worktrees/ })).toBeVisible());
    await expect(trigger).toHaveAccessibleName("Worktrees, non-default branches: shop: feature/cart");
    await expect(trigger.textContent).toBe("feature/cart");
    await userEvent.click(trigger);
    const trunk = canvas.getByRole("radio", { name: "trunk /projects/shop" });
    await waitFor(() => expect(trunk).toBeEnabled());
    await userEvent.click(trunk);
    await userEvent.click(canvas.getByRole("button", { name: "Switch and restart stack" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Worktrees" })).toBeVisible());
    await expect(trigger).toHaveAccessibleName("Worktrees");
  },
};

export const NonDefaultBranchAmongRepositories: Story = {
  args: {
    errorMessage: null,
    services: [
      { managed: true, name: "api", status: true },
      { managed: true, name: "web", status: true },
    ],
    repositories: [
      { ...factory_worktreeRepository(["api"]), id: "api", name: "api" },
      { ...factory_worktreeRepository(["web"]), defaultBranch: "trunk" },
    ],
    onRefreshWorktrees: fn(async () => null),
    onSwitchWorktree: fn(async () => null),
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    // A branch named main is still non-default when Git reports trunk.
    const trigger = await canvas.findByRole("button", {
      name: "Worktrees, non-default branches: shop: main",
    });
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toBeVisible();
    await userEvent.click(trigger);
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toHaveTextContent("main");
    await expect(trigger.textContent).toBe("api: main, shop: main");
    const selector = canvas.getByRole("combobox", { name: "Repository" });
    await expect(selector).toHaveValue("api");
    await waitFor(() => expect(canvas.getByRole("group", { name: "Choose a checkout for api" })).toBeVisible());
    await userEvent.selectOptions(selector, "shop");
    await waitFor(() => expect(canvas.getByRole("group", { name: "Choose a checkout for shop" })).toBeVisible());
  },
};

export const UnknownDefaultBranch: Story = {
  args: {
    ...CustomDefaultBranch.args,
    repositories: [
      { ...factory_worktreeRepository(["web"], ""), selectedPath: "/worktrees/cart", runningPath: "/worktrees/cart" },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toHaveTextContent("feature/cart");
  },
};

export const DetachedCheckout: Story = {
  args: {
    ...CustomDefaultBranch.args,
    repositories: [
      {
        ...factory_worktreeRepository(["web"]),
        selectedPath: "/worktrees/experiment",
        runningPath: "/worktrees/experiment",
      },
    ],
  },
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Worktrees" }));
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: /^Worktrees/ })).toHaveTextContent("Detached deadbee");
  },
};
