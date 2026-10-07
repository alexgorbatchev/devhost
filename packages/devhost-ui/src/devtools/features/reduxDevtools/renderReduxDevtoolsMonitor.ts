import { jsx } from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { ReduxDevtoolsMonitor } from "./components/ReduxDevtoolsMonitor";
import type { CoreStoreAction, CoreStoreState } from "@redux-devtools/app-core";
import type { Store } from "redux";
import type { ReduxDevtoolsDispose } from "./types";

export function renderReduxDevtoolsMonitor(
  container: HTMLElement,
  store: Store<CoreStoreState, CoreStoreAction>,
): ReduxDevtoolsDispose {
  // This imperative document bootstrap uses the same public JSX runtime as renderDevtools;
  // component-owned rendering remains in ReduxDevtoolsMonitor.
  // Upstream owns its Emotion styles in this separate monitor document; the injected launcher stays in Shadow DOM.
  const root = createRoot(container);
  root.render(jsx(ReduxDevtoolsMonitor, { store }));
  return () => root.unmount();
}
