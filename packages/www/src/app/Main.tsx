import React, { type JSX } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./App.css";

export function Main(): JSX.Element {
  return <App />;
}

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement !== null) {
  createRoot(rootElement).render(<Main />);
}
