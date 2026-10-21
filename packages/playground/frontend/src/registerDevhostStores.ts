import { reduxCounterStore } from "./reduxCounterStore";
import type { IDevhostReduxModule, IZustandCounterSnapshot } from "./types";
import { zustandCounterStore } from "./zustandCounterStore";

function isZustandCounterSnapshot(value: unknown): value is IZustandCounterSnapshot {
  return typeof value === "object" && value !== null && "count" in value && typeof value.count === "number";
}

// Registers the playground's Redux Toolkit and Zustand stores with devhost's Redux inspector, and returns the
// function that unregisters both.
export function registerDevhostStores(devhostRedux: IDevhostReduxModule): () => void {
  const unregisterRedux = devhostRedux.registerReduxDevtoolsStore({
    id: "redux-counter",
    name: "Redux Toolkit counter",
    store: reduxCounterStore,
  });
  const unregisterZustand = devhostRedux.registerZustandDevtoolsStore({
    id: "zustand-counter",
    name: "Zustand counter",
    store: zustandCounterStore,
    snapshot: (state) => ({ count: state.count }),
    restore: (snapshot) => {
      if (!isZustandCounterSnapshot(snapshot)) {
        throw new Error("Zustand counter replay requires a numeric count.");
      }
      return { count: snapshot.count };
    },
  });

  return () => {
    unregisterRedux();
    unregisterZustand();
  };
}
