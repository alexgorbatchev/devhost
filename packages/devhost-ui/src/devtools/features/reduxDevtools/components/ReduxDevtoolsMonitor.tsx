import { App } from "@redux-devtools/app-core";
import { Provider } from "react-redux";
import type { JSX } from "react";
import type { CoreStoreAction, CoreStoreState } from "@redux-devtools/app-core";
import type { Store } from "redux";

interface IReduxDevtoolsMonitorProps {
  store: Store<CoreStoreState, CoreStoreAction>;
}

export function ReduxDevtoolsMonitor({ store }: IReduxDevtoolsMonitorProps): JSX.Element {
  return (
    <Provider store={store}>
      <App />
    </Provider>
  );
}
