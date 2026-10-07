import { expect, test } from "bun:test";
import { createReduxDevtoolsRegistry } from "../createReduxDevtoolsRegistry";
import { createReduxStoreProducer } from "../createReduxStoreProducer";
import { factory_reduxStore } from "./fixtures/fixtures";

test("replaces the actual registration without allowing an old HMR cleanup to remove its successor", () => {
  const registry = createReduxDevtoolsRegistry();
  const first = factory_reduxStore();
  const second = factory_reduxStore();
  let changes = 0;
  const stop = registry.subscribe(() => {
    changes += 1;
  });
  const unregisterFirst = registry.register({
    id: "counter",
    name: "First",
    connectionId: "first",
    createProducer: () => createReduxStoreProducer(first.store, "first", "First"),
  });
  const unregisterSecond = registry.register({
    id: "counter",
    name: "Second",
    connectionId: "second",
    createProducer: () => createReduxStoreProducer(second.store, "second", "Second"),
  });
  unregisterFirst();
  expect(registry.read().map((entry) => entry.name)).toEqual(["Second"]);
  expect(changes).toBe(2);
  unregisterSecond();
  expect(registry.read()).toEqual([]);
  expect(changes).toBe(3);
  stop();
  registry.register({
    id: "counter",
    name: "Third",
    connectionId: "third",
    createProducer: () => createReduxStoreProducer(first.store, "third", "Third"),
  });
  expect(changes).toBe(3);
});

test("rejects empty identity instead of fabricating store availability", () => {
  const registry = createReduxDevtoolsRegistry();
  const { store } = factory_reduxStore();
  expect(() =>
    registry.register({
      id: "",
      name: "Counter",
      connectionId: "native",
      createProducer: () => createReduxStoreProducer(store, "native", "Counter"),
    }),
  ).toThrow("Redux DevTools registration requires a nonempty id and name.");
  expect(registry.read()).toEqual([]);
});
