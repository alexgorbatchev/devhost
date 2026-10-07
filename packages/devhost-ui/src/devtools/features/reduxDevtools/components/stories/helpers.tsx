import { useEffect, useState, useSyncExternalStore, type JSX } from "react";
import { REMOVE_INSTANCE, UPDATE_STATE } from "@redux-devtools/app-core";
import { instrument, type EnhancedStore } from "@redux-devtools/instrument";
import { createStore, type Action, type Store } from "redux";
import type { CoreStoreAction, CoreStoreState } from "@redux-devtools/app-core";
import { createReduxDevtoolsMonitorStore } from "../../createReduxDevtoolsMonitorStore";
import { createReduxStoreProducer } from "../../createReduxStoreProducer";
import type { IReduxDevtoolsProducer, ReduxDevtoolsDispose } from "../../types";
import { ReduxDevtoolsMonitor } from "../ReduxDevtoolsMonitor";

interface ICounterAction extends Action<string> {
  type: string;
}
type CounterStore = EnhancedStore<number, ICounterAction, null>;
interface IMonitorStoryHarness {
  monitor: Store<CoreStoreState, CoreStoreAction>;
  first: CounterStore;
  second: CounterStore;
  start: () => ReduxDevtoolsDispose;
  removeFirst: () => void;
  registerFirst: () => void;
}

function counter(state: number = 0, action: ICounterAction): number {
  return action.type === "INCREMENT" ? state + 1 : state;
}

function createMonitorStoryHarness(): IMonitorStoryHarness {
  const first = createStore(counter, 0, instrument<number, ICounterAction>());
  const second = createStore(counter, 10, instrument<number, ICounterAction>());
  const producers = new Map<string, IReduxDevtoolsProducer>();
  const disposers = new Map<string, ReduxDevtoolsDispose>();
  const monitor = createReduxDevtoolsMonitorStore((message) => {
    const producer = producers.get(message.instanceId);
    if (producer === undefined) throw new Error("The selected monitor producer is not registered.");
    producer.receive(message);
  });
  const register = (store: CounterStore, id: string, name: string): void => {
    if (producers.has(id)) return;
    const producer = createReduxStoreProducer(store, id, name);
    producers.set(id, producer);
    disposers.set(
      id,
      producer.subscribe((request) => {
        if (request.type === "ERROR") throw new Error(request.message);
        if (request.type === "DISCONNECTED") return;
        monitor.dispatch({ type: UPDATE_STATE, request, id });
      }),
    );
  };
  const remove = (id: string): void => {
    disposers.get(id)?.();
    disposers.delete(id);
    producers.delete(id);
    monitor.dispatch({ type: REMOVE_INSTANCE, id });
  };
  return {
    monitor,
    first,
    second,
    registerFirst: (): void => register(first, "project-a", "Project A"),
    removeFirst: (): void => remove("project-a"),
    start: () => {
      register(first, "project-a", "Project A");
      register(second, "project-b", "Project B");
      return (): void => {
        remove("project-a");
        remove("project-b");
      };
    },
  };
}

/** Real instrumented stores and producer dispatch; no extension or native-browser certification. */
interface IReduxMonitorStoryProps {
  shouldRegisterInitially?: boolean;
}
export function ReduxMonitorStory({ shouldRegisterInitially = true }: IReduxMonitorStoryProps): JSX.Element {
  const [harness] = useState(createMonitorStoryHarness);
  useEffect(() => {
    if (shouldRegisterInitially) return harness.start();
    return harness.removeFirst;
  }, [harness, shouldRegisterInitially]);
  const first = useSyncExternalStore(harness.first.subscribe, harness.first.getState);
  const second = useSyncExternalStore(harness.second.subscribe, harness.second.getState);
  return (
    <>
      <section aria-label="Real host counters">
        <output aria-label="Project A count">{first}</output>
        <button type="button" onClick={() => harness.first.dispatch({ type: "INCREMENT" })}>
          Increment Project A
        </button>
        <output aria-label="Project B count">{second}</output>
        <button type="button" onClick={() => harness.second.dispatch({ type: "INCREMENT" })}>
          Increment Project B
        </button>
        <button type="button" onClick={harness.removeFirst}>
          Remove Project A
        </button>
        <button type="button" onClick={harness.registerFirst}>
          Register Project A
        </button>
      </section>
      <section aria-label="Redux monitor">
        <ReduxDevtoolsMonitor store={harness.monitor} />
      </section>
    </>
  );
}
