import type { ReduxDevtoolsDispose } from "../../types";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { instrument } from "@redux-devtools/instrument";
import { create } from "zustand";
import { createStore } from "zustand/vanilla";
import { devtools } from "zustand/middleware";
import { registerReduxDevtoolsStore, registerZustandDevtoolsStore } from "../../index";
import { loadServedReduxRegistrationApi } from "./loadServedReduxRegistrationApi";
import { isInstrumentedReduxStore } from "../../isInstrumentedReduxStore";
import type { NativeLiftedState } from "../../types";
import type { ICounterFixtureState, INativeReduxFixture, IReduxHostRegistrationApi } from "../helpers";

const parameters = new URL(location.href).searchParams;
const project = parameters.get("project") ?? "A";
const initialHook: unknown = Reflect.get(window, "__REDUX_DEVTOOLS_EXTENSION__");
const counter = createSlice({
  name: project + "-counter",
  initialState: { count: 0 },
  reducers: {
    increment: (state) => {
      state.count += 1;
    },
  },
});
const toolkit = [1, 2].map((number) => ({
  name: `${project} Toolkit${number}`,
  store: configureStore({
    reducer: counter.reducer,
    devTools: initialHook !== undefined ? { name: `${project} Toolkit${number}`, latency: 0 } : false,
    enhancers: (defaults) => (initialHook === undefined ? defaults().concat(instrument()) : defaults()),
  }),
}));
const createZustandStore =
  parameters.get("zustand") === "bound" ? create<ICounterFixtureState>() : createStore<ICounterFixtureState>();
const zustand = [1, 2].map((number) => ({
  name: `${project} Zustand${number}`,
  store: createZustandStore(
    devtools(
      (set) => ({
        count: 0,
        increment: () => set((state) => ({ count: state.count + 1 }), false, `${project}/increment`),
      }),
      { name: `${project} Zustand${number}`, enabled: true },
    ),
  ),
}));
const zustandActions = zustand.map((entry) => entry.store.getState().increment);
let unregisters: ReduxDevtoolsDispose[] = [];
const unregister = (): void => {
  unregisters.forEach((remove) => remove());
  unregisters = [];
};
const registerWithApi = (api: IReduxHostRegistrationApi): void => {
  const previous = unregisters;
  unregisters = [
    ...toolkit.map((entry, index) =>
      api.registerReduxDevtoolsStore({ id: `toolkit${index}`, name: entry.name, store: entry.store }),
    ),
    ...zustand.map((entry, index) =>
      api.registerZustandDevtoolsStore({
        id: `zustand${index}`,
        name: entry.name,
        store: entry.store,
        snapshot: (state) => ({ count: state.count }),
        restore: (state) => {
          if (typeof state !== "object" || state === null || !("count" in state) || typeof state.count !== "number")
            throw new Error("Counter replay requires numeric count.");
          return { count: state.count };
        },
      }),
    ),
  ];
  previous.forEach((remove) => remove());
};
const register = (): void => registerWithApi({ registerReduxDevtoolsStore, registerZustandDevtoolsStore });
function readNativeHistory(store: unknown): NativeLiftedState {
  if (!isInstrumentedReduxStore(store)) throw new Error("Native fixture Toolkit instrumentation is absent.");
  return store.liftedStore.getState();
}
const fixture: INativeReduxFixture = {
  read: () => ({
    toolkit: toolkit.map((entry) => entry.store.getState().count),
    zustand: zustand.map((entry) => entry.store.getState().count),
    isZustandBoundStore: zustand.map((entry) => typeof entry.store === "function"),
    hasOriginalActions: zustand.map((entry, index) => entry.store.getState().increment === zustandActions[index]),
    hasActions: zustand.map((entry) => typeof entry.store.getState().increment === "function"),
    hasNativeZustandMiddleware: zustand.map((entry) => typeof entry.store.devtools?.cleanup === "function"),
    toolkitActionIds: toolkit.map((entry) => readNativeHistory(entry.store).stagedActionIds),
    isHookUnchanged: initialHook === Reflect.get(window, "__REDUX_DEVTOOLS_EXTENSION__"),
  }),
  register,
  unregister,
  replace: register,
  registerInvalid: () => {
    unregister();
    unregisters = [
      registerReduxDevtoolsStore({
        id: "invalid",
        name: "Invalid Toolkit",
        store: configureStore({ reducer: counter.reducer, devTools: false }),
      }),
    ];
  },
  openExtension: () => {
    const hook: unknown = Reflect.get(window, "__REDUX_DEVTOOLS_EXTENSION__");
    if (typeof hook !== "function" || !("open" in hook) || typeof hook.open !== "function")
      throw new Error("Released native Redux extension is unavailable.");
    hook.open("window");
  },
};
window.reduxNativeFixture = fixture;
function button(name: string, action: ReduxDevtoolsDispose): void {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = name;
  node.addEventListener("click", action);
  document.body.append(node);
}
toolkit.forEach((entry) => button(`Increment ${entry.name}`, () => entry.store.dispatch(counter.actions.increment())));
zustand.forEach((entry) => button(`Increment ${entry.name}`, () => entry.store.getState().increment()));
button("Register stores", register);
button("Unregister stores", unregister);
button("Replace stores", register);
button("Invalid store", fixture.registerInvalid);
button("Open native extension", fixture.openExtension);
if (parameters.get("registration") === "served") registerWithApi(await loadServedReduxRegistrationApi());
else if (parameters.get("registration") !== "late") register();
