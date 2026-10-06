import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { useState, type JSX } from "react";
import { APITester } from "./APITester";
import { PlaygroundLayout } from "./components/PlaygroundLayout";
import { QueryPlayground } from "./components/QueryPlayground";
import "./index.css";

export function App(): JSX.Element {
  const [queryClient] = useState(() => new QueryClient());
  const [router] = useState(() => {
    const rootRoute = createRootRoute({ component: PlaygroundLayout });
    const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: APITester });
    const queryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/query", component: QueryPlayground });

    return createRouter({ routeTree: rootRoute.addChildren([indexRoute, queryRoute]) });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

export default App;
