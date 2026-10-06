import { expect, test } from "bun:test";
import { parseNativeBrowserUpdate } from "../parseNativeBrowserUpdate";

test("rejects an unverified or incomplete native availability message", () => {
  expect(parseNativeBrowserUpdate({ type: "state", revision: 1, state: { isReactAvailable: true } })).toBeNull();
  expect(
    parseNativeBrowserUpdate({
      type: "state",
      revision: 0,
      state: {
        isConnected: true,
        documentState: "bound",
        isReactAvailable: false,
        isNativeWindowOpen: false,
        isNativeSessionLost: false,
        browserVersion: "",
        message: "",
      },
    }),
  ).toBeNull();
});

test("reads a correlated native error without claiming a live inspector", () => {
  expect(parseNativeBrowserUpdate({ type: "error", id: "connect_1", error: "Browser discovery failed." })).toEqual({
    type: "error",
    id: "connect_1",
    error: "Browser discovery failed.",
  });
  expect(
    parseNativeBrowserUpdate({
      type: "error",
      id: "connect_1",
      error: "Browser discovery failed.",
      token: "unrecognized",
    }),
  ).toBeNull();
});

test("rejects availability that contradicts the document, connection, or lost native session", () => {
  const state = {
    isConnected: true,
    documentState: "bound",
    isReactAvailable: true,
    isNativeWindowOpen: false,
    isNativeSessionLost: false,
    browserVersion: "Chrome/154.0.8037.92",
    message: "Observed native host.",
  };
  expect(
    parseNativeBrowserUpdate({ type: "state", revision: 1, state: { ...state, documentState: "unbound" } }),
  ).toBeNull();
  expect(
    parseNativeBrowserUpdate({ type: "state", revision: 1, state: { ...state, documentState: "ambiguous" } }),
  ).toBeNull();
  expect(parseNativeBrowserUpdate({ type: "state", revision: 1, state: { ...state, isConnected: false } })).toBeNull();
  expect(
    parseNativeBrowserUpdate({ type: "state", revision: 1, state: { ...state, isNativeSessionLost: true } }),
  ).toBeNull();
});
