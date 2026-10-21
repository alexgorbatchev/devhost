import { devtools } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { IZustandCounterState } from "./types";

export const zustandCounterStore = createStore<IZustandCounterState>()(
  devtools(
    (set) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 }), false, "counter/increment"),
    }),
    { name: "Zustand counter", enabled: true },
  ),
);
