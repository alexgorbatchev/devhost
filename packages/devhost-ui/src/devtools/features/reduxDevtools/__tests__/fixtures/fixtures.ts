import { configureStore, createSlice } from "@reduxjs/toolkit";
import { instrument } from "@redux-devtools/instrument";
import { create } from "zustand";
import { createStore } from "zustand/vanilla";
import { devtools } from "zustand/middleware";
import type { IZustandDevtoolsRegistrationOptions } from "../../types";
import type {
  ICounterFixtureSnapshot,
  ICounterFixtureState,
  IReduxFixture,
  IRichCounterFixtureSnapshot,
} from "../helpers";

export function factory_reduxStore(): IReduxFixture {
  const counter = createSlice({
    name: "counter",
    initialState: { count: 0 },
    reducers: {
      increment: (state) => {
        state.count += 1;
      },
    },
  });
  return {
    store: configureStore({
      reducer: counter.reducer,
      devTools: false,
      enhancers: (defaults) => defaults().concat(instrument()),
    }),
    increment: counter.actions.increment,
  };
}

export function factory_zustandRegistration(): IZustandDevtoolsRegistrationOptions<
  ICounterFixtureState,
  ICounterFixtureSnapshot
> {
  const store = createStore<ICounterFixtureState>()(
    devtools(
      (set) => ({
        count: 0,
        increment: () => set((state) => ({ count: state.count + 1 }), false, "counter/increment"),
      }),
      { name: "Native Zustand", enabled: true },
    ),
  );
  return {
    id: "zustand",
    name: "Zustand counter",
    store,
    snapshot: (state) => ({ count: state.count }),
    restore: (snapshot) => {
      if (
        typeof snapshot !== "object" ||
        snapshot === null ||
        !("count" in snapshot) ||
        typeof snapshot.count !== "number"
      ) {
        throw new Error("Counter snapshot must have a numeric count.");
      }
      return { count: snapshot.count };
    },
  };
}

export function factory_richZustandRegistration(): IZustandDevtoolsRegistrationOptions<
  ICounterFixtureState,
  IRichCounterFixtureSnapshot
> {
  const registration = factory_zustandRegistration();
  return {
    ...registration,
    snapshot: (state) => {
      const snapshot: IRichCounterFixtureSnapshot = {
        count: state.count,
        createdAt: new Date("2026-10-06T00:00:00Z"),
        values: new Map([["count", state.count]]),
        flags: new Set(["native"]),
        optional: undefined,
      };
      snapshot.self = snapshot;
      return snapshot;
    },
  };
}

export function factory_boundZustandRegistration(): IZustandDevtoolsRegistrationOptions<
  ICounterFixtureState,
  ICounterFixtureSnapshot
> {
  return {
    id: "bound-zustand",
    name: "Bound Zustand counter",
    store: create<ICounterFixtureState>()(
      devtools(
        (set) => ({
          count: 0,
          increment: () => set((state) => ({ count: state.count + 1 }), false, "counter/increment"),
        }),
        { name: "Native bound Zustand", enabled: true },
      ),
    ),
    snapshot: (state) => ({ count: state.count }),
    restore: (snapshot) => {
      if (
        typeof snapshot !== "object" ||
        snapshot === null ||
        !("count" in snapshot) ||
        typeof snapshot.count !== "number"
      )
        throw new Error("Counter snapshot must have a numeric count.");
      return { count: snapshot.count };
    },
  };
}

export function factory_failingSnapshotRegistration(): IZustandDevtoolsRegistrationOptions<
  ICounterFixtureState,
  ICounterFixtureSnapshot
> {
  const registration = factory_zustandRegistration();
  return {
    ...registration,
    snapshot: (state) => {
      if (state.count === 1) throw new Error("Host snapshot is temporarily unavailable.");
      return { count: state.count };
    },
  };
}
