import { afterAll, expect, it } from "bun:test";
import { isDemoStackReady } from "../isDemoStackReady";
import type { IStartingStackState } from "../types";
import { serveStartingStack } from "./fixtures/serveStartingStack";

const state: IStartingStackState = { isApiUp: true, isPageHealthy: false };
const server = serveStartingStack(state);
const signal = new AbortController().signal;

afterAll(async () => {
  await server.stop(true);
});

it("reports a stack ready only once a browser navigation reaches the app instead of the startup page", async () => {
  state.isApiUp = true;
  state.isPageHealthy = false;
  const whileStarting = await isDemoStackReady(server.url.href, signal);
  state.isPageHealthy = true;

  expect({ whileStarting, afterHealthCheck: await isDemoStackReady(server.url.href, signal) }).toEqual({
    whileStarting: false,
    afterHealthCheck: true,
  });
});

it("reports a stack whose API does not answer as not ready", async () => {
  state.isApiUp = false;
  state.isPageHealthy = true;

  expect(await isDemoStackReady(server.url.href, signal)).toBe(false);
});
