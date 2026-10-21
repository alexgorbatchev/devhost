import { instrument } from "@redux-devtools/instrument";
import { configureStore, createSlice } from "@reduxjs/toolkit";

const counter = createSlice({
  name: "counter",
  initialState: { count: 0 },
  reducers: {
    increment: (state) => {
      state.count += 1;
    },
  },
});

export const { increment } = counter.actions;

// Instrumented once, as devhost's Redux inspector reads the store's own lifted history.
export const reduxCounterStore = configureStore({
  reducer: counter.reducer,
  devTools: false,
  enhancers: (defaults) => defaults().concat(instrument()),
});
