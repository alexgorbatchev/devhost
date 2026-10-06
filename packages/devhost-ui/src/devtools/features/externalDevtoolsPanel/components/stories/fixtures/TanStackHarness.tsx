import { Debouncer } from "@tanstack/pacer";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { useForm } from "@tanstack/react-form";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { pacerDevtoolsPlugin } from "@tanstack/react-pacer-devtools";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools, ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools/production";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsInProd, TanStackRouterDevtoolsPanelInProd } from "@tanstack/react-router-devtools";
import { rowSelectionFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { tableDevtoolsPlugin, useTanStackTableDevtools } from "@tanstack/react-table-devtools";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import { DevtoolsToolbar } from "@/devtools/shared/components/DevtoolsToolbar";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";
import { useExternalDevtoolsLaunchers } from "../../../hooks/useExternalDevtoolsLaunchers";
import { ExternalDevtoolsPanel } from "../../ExternalDevtoolsPanel";

const features = tableFeatures({ rowSelectionFeature });
const columns = [{ accessorKey: "name", header: "Name" }];
const data = [{ name: "Ada" }, { name: "Grace" }];

interface ITanStackHarnessProps {
  globals: Partial<Record<string, unknown>>;
  hasStandaloneTools?: boolean;
  hasEmbeddedTools?: boolean;
  hasSecondShell?: boolean;
  shouldHideTrigger?: boolean;
  shouldRequireUrlFlag?: boolean;
  hasUnrelatedMarkup?: boolean;
}

interface ITanStackToolbarProps {
  globals: Partial<Record<string, unknown>>;
  isEnabled: boolean;
}

function TanStackToolbar({ globals, isEnabled }: ITanStackToolbarProps): JSX.Element {
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(isEnabled);
  return (
    <StorybookThemeProvider globals={globals}>
      <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="tanstack">
        <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} />
      </DevtoolsToolbar>
    </StorybookThemeProvider>
  );
}

function TanStackLibraries(): JSX.Element {
  const form = useForm({ defaultValues: { name: "Ada" }, formId: "devhost-form" });
  const table = useTable({ key: "devhost-table", features, columns, data });
  useTanStackTableDevtools(table);
  const [result, setResult] = useState("idle");
  const [debouncer] = useState(
    () => new Debouncer((value: string) => setResult(value), { key: "devhost-debouncer", wait: 60000 }),
  );
  useEffect(() => () => debouncer.cancel(), [debouncer]);

  return (
    <section aria-label="Native TanStack libraries" data-testid="TanStackLibraries">
      <form.Field name="name">
        {(field) => (
          <label>
            Form name
            <input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </label>
        )}
      </form.Field>
      <button type="button" onClick={() => table.getRowModel().rows[0]?.toggleSelected()}>
        Toggle Ada selection
      </button>
      <output aria-label="Table selection">{JSON.stringify(table.state.rowSelection)}</output>
      <button type="button" onClick={() => debouncer.maybeExecute("executed")}>
        Schedule debouncer
      </button>
      <output aria-label="Debounced result">{result}</output>
    </section>
  );
}

function createHarnessRouter() {
  const rootRoute = createRootRoute({ component: () => null });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => null });
  const itemsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/items", component: () => null });
  return createRouter({ history: createMemoryHistory(), routeTree: rootRoute.addChildren([indexRoute, itemsRoute]) });
}

export function TanStackHarness({
  globals,
  hasStandaloneTools = false,
  hasEmbeddedTools = false,
  hasSecondShell = false,
  shouldHideTrigger = false,
  shouldRequireUrlFlag = false,
  hasUnrelatedMarkup = false,
}: ITanStackHarnessProps): JSX.Element {
  const [queryClient] = useState(() => {
    const client = new QueryClient();
    client.setQueryData(["devhost-shell"], "initial");
    return client;
  });
  const [router] = useState(createHarnessRouter);
  const [plugins] = useState(() =>
    hasEmbeddedTools
      ? [
          { name: "TanStack Query", render: <ReactQueryDevtoolsPanel /> },
          { name: "TanStack Router", render: <TanStackRouterDevtoolsPanelInProd router={router} /> },
        ]
      : [formDevtoolsPlugin(), tableDevtoolsPlugin(), pacerDevtoolsPlugin()],
  );
  const [isEnabled, setIsEnabled] = useState(true);
  const [isToolbarMounted, setIsToolbarMounted] = useState(true);
  const [isShellMounted, setIsShellMounted] = useState(!hasUnrelatedMarkup);
  const [isUrlFlagRequired, setIsUrlFlagRequired] = useState(shouldRequireUrlFlag);
  const [isBrandExpanded, setIsBrandExpanded] = useState(false);
  const [areLibrariesMounted, setAreLibrariesMounted] = useState(true);
  const [generation, setGeneration] = useState(0);

  return (
    <QueryClientProvider client={queryClient}>
      <div data-testid="TanStackHarness">
        <button type="button" onClick={() => setIsEnabled((value) => !value)}>
          Toggle aggregation
        </button>
        <button type="button" onClick={() => setIsToolbarMounted((value) => !value)}>
          Toggle toolbar mount
        </button>
        <button type="button" onClick={() => setIsShellMounted((value) => !value)}>
          Toggle shell
        </button>
        <button type="button" onClick={() => setGeneration((value) => value + 1)}>
          Remount shell
        </button>
        <button type="button" onClick={() => setAreLibrariesMounted((value) => !value)}>
          Toggle native libraries
        </button>
        <button
          type="button"
          onClick={() => {
            setIsUrlFlagRequired(false);
            setGeneration((value) => value + 1);
          }}
        >
          Remove URL gate
        </button>
        {hasUnrelatedMarkup ? (
          <aside data-testid="tanstack_devtools" aria-label="Unrelated TanStack documentation">
            <button
              type="button"
              aria-label="Open TanStack Devtools"
              aria-expanded={isBrandExpanded}
              onClick={() => setIsBrandExpanded((value) => !value)}
            >
              TanStack documentation
            </button>
            {isBrandExpanded ? <p>TanStack plugin setup documentation</p> : null}
          </aside>
        ) : null}
        <button type="button" onClick={() => queryClient.setQueryData(["devhost-shell"], "updated")}>
          Update query
        </button>
        <button type="button" onClick={() => router.navigate({ to: "/items" })}>
          Navigate to items
        </button>
        {areLibrariesMounted ? <TanStackLibraries /> : null}
        <RouterProvider router={router} />
        {hasStandaloneTools ? (
          <>
            <ReactQueryDevtools initialIsOpen={false} />
            <TanStackRouterDevtoolsInProd router={router} initialIsOpen={false} />
          </>
        ) : null}
        {isShellMounted ? (
          <TanStackDevtools
            key={generation}
            plugins={plugins}
            config={{ defaultOpen: false, triggerHidden: shouldHideTrigger, requireUrlFlag: isUrlFlagRequired }}
          />
        ) : null}
        {hasSecondShell ? <TanStackDevtools plugins={plugins} /> : null}
        {isToolbarMounted ? <TanStackToolbar globals={globals} isEnabled={isEnabled} /> : null}
      </div>
    </QueryClientProvider>
  );
}
