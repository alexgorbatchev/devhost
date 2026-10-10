/**
 * Entry point of the demo videos page, a document of its own outside the playground's router.
 *
 * It is included in `src/videos.html`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VideoGallery } from "./components/VideoGallery";
import "./index.css";

const elem = document.getElementById("root");
if (!elem) throw new Error("The videos page has no #root element");

const queryClient = new QueryClient();
const app = (
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <VideoGallery />
    </QueryClientProvider>
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(elem)).render(app);
