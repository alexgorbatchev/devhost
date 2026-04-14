/** @jsxImportSource react */
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";

export function ReactDevtoolsHost() {
  const [queryClient] = React.useState(() => new QueryClient());
  const [router] = React.useState(() => {
    const rootRoute = createRootRoute({ component: () => null });
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => null });
    const routeTree = rootRoute.addChildren([indexRoute]);
    return createRouter({ history: createMemoryHistory(), routeTree });
  });

  return (
    <div data-testid="ReactDevtoolsHost">
      <QueryClientProvider client={queryClient}>
        <ReactQueryDevtools />
      </QueryClientProvider>
      <RouterProvider router={router} />
      <TanStackRouterDevtools router={router} />
    </div>
  );
}
