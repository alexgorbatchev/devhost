import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState, type JSX } from "react";
import { APITester } from "./APITester";
import { InspectorsPlayground } from "./components/InspectorsPlayground";
import { PlaygroundLayout } from "./components/PlaygroundLayout";
import { QueryPlayground } from "./components/QueryPlayground";
import "./index.css";

export function App(): JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: PlaygroundLayout });
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: APITester });
    const queryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/query", component: QueryPlayground });
    const inspectorsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/inspectors",
      component: InspectorsPlayground,
    });

    return createRouter({ routeTree: rootRoute.addChildren([indexRoute, queryRoute, inspectorsRoute]) });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
