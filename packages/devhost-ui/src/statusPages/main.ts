import { createRoot } from "react-dom/client";
import { jsx } from "react/jsx-runtime";
import { StatusPage } from "./components/StatusPage";
import { createRecoveryClient } from "./createRecoveryClient";
import { statusPageSchema } from "./statusPageSchema";

const root = document.getElementById("devhost-status");
const payload = document.getElementById("devhost-status-data");
if (root && payload) {
  const data = statusPageSchema.parse(JSON.parse(payload.textContent ?? ""));
  const client = createRecoveryClient(location.href, window.fetch.bind(window), () => location.replace(location.href));
  // Imperative document bootstrap, following renderDevtools; the component owns all JSX.
  createRoot(root).render(jsx(StatusPage, { data, client }));
}
