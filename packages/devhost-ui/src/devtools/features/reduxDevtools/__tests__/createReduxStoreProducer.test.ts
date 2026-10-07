import assert from "node:assert";
import { expect, test } from "bun:test";
import { ActionCreators } from "@redux-devtools/instrument";
import { parse } from "jsan";
import { createReduxStoreProducer } from "../createReduxStoreProducer";
import { factory_reduxStore } from "./fixtures/fixtures";
import type { ProducerMessage } from "../types";

test("publishes existing real Toolkit history and replays through the same native lifted store", () => {
  const { store, increment } = factory_reduxStore();
  store.dispatch(increment());
  store.dispatch(increment());
  const producer = createReduxStoreProducer(store, "toolkit-instance", "Toolkit");
  const messages: ProducerMessage[] = [];
  const unsubscribe = producer.subscribe((message) => messages.push(message));
  const initial = messages[0];
  assert(initial?.type === "STATE");
  expect(parse(String(initial.payload))).toMatchObject({ currentStateIndex: 2, stagedActionIds: [0, 1, 2] });
  producer.receive({
    type: "DISPATCH",
    instanceId: "toolkit-instance",
    action: ActionCreators.jumpToState(0),
    isToAll: false,
  });
  expect(store.getState()).toEqual({ count: 0 });
  producer.receive({
    type: "DISPATCH",
    instanceId: "toolkit-instance",
    action: ActionCreators.jumpToState(2),
    isToAll: false,
  });
  expect(store.getState()).toEqual({ count: 2 });
  producer.receive({
    type: "DISPATCH",
    instanceId: "toolkit-instance",
    action: ActionCreators.commit(),
    isToAll: false,
  });
  expect(store.liftedStore.getState().stagedActionIds).toEqual([0]);
  unsubscribe();
  const count = messages.length;
  store.dispatch(increment());
  expect(messages.length).toBe(count);
  expect(store.getState()).toEqual({ count: 3 });
});

test("rejects a plain store with actionable public instrumentation setup", () => {
  expect(() => createReduxStoreProducer({ getState: () => ({ count: 0 }) }, "plain", "Plain")).toThrow(
    "Redux DevTools requires the public instrument EnhancedStore.liftedStore capability. Instrument the host store once; do not add another enhancer to an already instrumented store.",
  );
});

test("native skip, sweep, reorder, lock, pause, reset, revert and imported lifted history control the actual Toolkit store", () => {
  const { store, increment } = factory_reduxStore();
  const producer = createReduxStoreProducer(store, "native", "Native");
  store.dispatch(increment());
  store.dispatch(increment());
  const imported = store.liftedStore.getState();
  producer.receive({ type: "DISPATCH", instanceId: "native", action: ActionCreators.toggleAction(1), isToAll: false });
  expect(store.getState()).toEqual({ count: 1 });
  producer.receive({ type: "DISPATCH", instanceId: "native", action: ActionCreators.sweep(), isToAll: false });
  expect(store.liftedStore.getState().stagedActionIds).toEqual([0, 2]);
  producer.receive({
    type: "DISPATCH",
    instanceId: "native",
    action: ActionCreators.importState(imported),
    isToAll: false,
  });
  expect(store.getState()).toEqual({ count: 2 });
  producer.receive({
    type: "DISPATCH",
    instanceId: "native",
    action: ActionCreators.reorderAction(2, 1),
    isToAll: false,
  });
  expect(store.liftedStore.getState().stagedActionIds).toEqual([0, 2, 1]);
  producer.receive({
    type: "DISPATCH",
    instanceId: "native",
    action: ActionCreators.lockChanges(true),
    isToAll: false,
  });
  store.dispatch(increment());
  expect(store.getState()).toEqual({ count: 2 });
  producer.receive({
    type: "DISPATCH",
    instanceId: "native",
    action: ActionCreators.lockChanges(false),
    isToAll: false,
  });
  producer.receive({
    type: "DISPATCH",
    instanceId: "native",
    action: ActionCreators.pauseRecording(true),
    isToAll: false,
  });
  expect(store.liftedStore.getState().isPaused).toBe(true);
  producer.receive({
    type: "DISPATCH",
    instanceId: "native",
    action: ActionCreators.pauseRecording(false),
    isToAll: false,
  });
  expect(store.liftedStore.getState().isPaused).toBe(false);
  const committedState = store.liftedStore.getState().committedState;
  producer.receive({ type: "DISPATCH", instanceId: "native", action: ActionCreators.rollback(), isToAll: false });
  expect(store.getState()).toEqual(committedState);
  store.dispatch(increment());
  producer.receive({ type: "DISPATCH", instanceId: "native", action: ActionCreators.reset(), isToAll: false });
  expect(store.getState()).toEqual({ count: 0 });
  expect(() =>
    producer.receive({
      type: "DISPATCH",
      instanceId: "native",
      action: { type: "JUMP_TO_STATE", index: 9 },
      isToAll: false,
    }),
  ).toThrow("Redux history index is out of range.");
});
