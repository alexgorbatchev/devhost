import { createRoot } from "react-dom/client";
import { ReduxDevtoolsMonitor } from "./ReduxDevtoolsMonitor";
import type { CoreStoreAction, CoreStoreState } from "@redux-devtools/app-core";
import type { Store } from "redux";

export function renderReduxDevtoolsMonitor(
  container: HTMLElement,
  store: Store<CoreStoreState, CoreStoreAction>,
): () => void {
  // Upstream owns its Emotion styles in this separate monitor document; the injected launcher stays in Shadow DOM.
  const root = createRoot(container);
  root.render(<ReduxDevtoolsMonitor store={store} />);
  return () => root.unmount();
}
