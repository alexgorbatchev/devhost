import type { ReduxDevtoolsListener } from "./types";
import type { IReduxDevtoolsRegistration, IReduxDevtoolsRegistry } from "./types";

export function createReduxDevtoolsRegistry(): IReduxDevtoolsRegistry {
  const entries = new Map<string, IReduxDevtoolsRegistration>();
  const listeners = new Set<ReduxDevtoolsListener>();
  const emit = (): void => {
    listeners.forEach((listener) => listener());
  };
  return {
    version: 1,
    read: () => [...entries.values()],
    register: (entry) => {
      if (entry.id.trim() === "" || entry.name.trim() === "")
        throw new Error("Redux DevTools registration requires a nonempty id and name.");
      entries.set(entry.id, entry);
      emit();
      return () => {
        if (entries.get(entry.id) !== entry) return;
        entries.delete(entry.id);
        emit();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
