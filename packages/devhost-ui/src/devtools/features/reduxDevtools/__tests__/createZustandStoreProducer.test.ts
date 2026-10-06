import assert from "node:assert";
import { expect, test } from "bun:test";
import { parse } from "jsan";
import { createZustandStoreProducer } from "../createZustandStoreProducer";
import {
  factory_failingSnapshotRegistration,
  factory_richZustandRegistration,
  factory_zustandRegistration,
} from "./fixtures";
import type { ProducerMessage } from "../types";

test("records real native-middleware Zustand updates and restores data without replacing host actions", () => {
  const registration = factory_zustandRegistration();
  const action = registration.store.getState().increment;
  const producer = createZustandStoreProducer(registration, "zustand-instance");
  const messages: ProducerMessage[] = [];
  const unsubscribe = producer.subscribe((message) => messages.push(message));
  registration.store.getState().increment();
  const recorded = messages[1];
  assert(recorded?.type === "ACTION");
  expect(parse(String(recorded.payload))).toEqual({ count: 1 });
  expect(recorded.nextActionId).toBe(2);
  producer.receive({
    type: "DISPATCH",
    instanceId: "zustand-instance",
    action: { type: "JUMP_TO_STATE", index: 0 },
    state: '{"count":0}',
    isToAll: false,
  });
  expect(registration.store.getState().count).toBe(0);
  expect(registration.store.getState().increment).toBe(action);
  expect(messages.length).toBe(2);
  registration.store.getState().increment();
  expect(registration.store.getState().count).toBe(1);
  producer.receive({ type: "DISPATCH", instanceId: "zustand-instance", action: { type: "RESET" }, isToAll: false });
  expect(registration.store.getState().count).toBe(0);
  expect(messages.at(-1)?.type).toBe("INIT");
  expect(() =>
    producer.receive({
      type: "DISPATCH",
      instanceId: "zustand-instance",
      action: { type: "JUMP_TO_STATE", index: 0 },
      state: '{"count":"bad"}',
      isToAll: false,
    }),
  ).toThrow("Counter snapshot must have a numeric count.");
  expect(registration.store.getState().increment).toBe(action);
  unsubscribe();
  const count = messages.length;
  registration.store.getState().increment();
  expect(messages.length).toBe(count);
});

test("commit and revert apply real current/committed snapshots, while producer cleanup leaves native state actions usable", () => {
  const registration = factory_zustandRegistration();
  const producer = createZustandStoreProducer(registration, "native");
  const messages: ProducerMessage[] = [];
  const unsubscribe = producer.subscribe((message) => messages.push(message));
  registration.store.getState().increment();
  producer.receive({ type: "DISPATCH", instanceId: "native", action: { type: "COMMIT" }, isToAll: false });
  const committed = messages.at(-1);
  assert(committed?.type === "INIT");
  expect(parse(String(committed.payload))).toEqual({ count: 1 });
  registration.store.getState().increment();
  producer.receive({
    type: "DISPATCH",
    instanceId: "native",
    action: { type: "ROLLBACK" },
    state: '{"count":1}',
    isToAll: false,
  });
  expect(registration.store.getState().count).toBe(1);
  unsubscribe();
  registration.store.getState().increment();
  expect(registration.store.getState().count).toBe(2);
});

test("upstream JSAN carries dates, maps, sets, undefined and cycles while replay preserves real host functions", () => {
  const registration = factory_richZustandRegistration();
  const action = registration.store.getState().increment;
  const producer = createZustandStoreProducer(registration, "rich");
  const messages: ProducerMessage[] = [];
  const unsubscribe = producer.subscribe((message) => messages.push(message));
  const initial = messages[0];
  assert(initial?.type === "INIT");
  const snapshot = parse(String(initial.payload));
  assert(
    typeof snapshot === "object" &&
      snapshot !== null &&
      "createdAt" in snapshot &&
      "values" in snapshot &&
      "flags" in snapshot &&
      "optional" in snapshot &&
      "self" in snapshot,
  );
  expect(snapshot.createdAt).toEqual(new Date("2026-10-06T00:00:00Z"));
  expect(snapshot.values).toEqual(new Map([["count", 0]]));
  expect(snapshot.flags).toEqual(new Set(["native"]));
  expect(snapshot.optional).toBeUndefined();
  expect(Object.hasOwn(snapshot, "optional")).toBe(true);
  expect(snapshot.self).toBe(snapshot);
  registration.store.getState().increment();
  producer.receive({
    type: "DISPATCH",
    instanceId: "rich",
    action: { type: "JUMP_TO_STATE", index: 0 },
    state: String(initial.payload),
    isToAll: false,
  });
  expect(registration.store.getState().count).toBe(0);
  expect(registration.store.getState().increment).toBe(action);
  unsubscribe();
});

test("a host snapshot failure reports setup without breaking actual state changes and positively recovers", () => {
  const registration = factory_failingSnapshotRegistration();
  const producer = createZustandStoreProducer(registration, "recover");
  const messages: ProducerMessage[] = [];
  const unsubscribe = producer.subscribe((message) => messages.push(message));
  expect(() => registration.store.getState().increment()).not.toThrow();
  expect(registration.store.getState().count).toBe(1);
  expect(messages.at(-1)).toEqual({
    type: "ERROR",
    id: "recover",
    message: "Host snapshot is temporarily unavailable.",
  });
  registration.store.getState().increment();
  const recovered = messages.at(-1);
  assert(recovered?.type === "ACTION");
  expect(parse(String(recovered.payload))).toEqual({ count: 2 });
  expect(recovered.nextActionId).toBe(2);
  unsubscribe();
});
