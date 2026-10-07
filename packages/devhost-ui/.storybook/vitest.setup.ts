import "../src/devtools/shared/devtools.css";
import { afterEach, assert, vi } from "vitest";

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const unmountWarnings: unknown[][] = [];
const jotaiDeprecationWarnings: unknown[][] = [];
const emotionServerRenderingNotices: unknown[][] = [];
// What Emotion's development build logs for a selector that breaks when styles are rendered on a server.
const emotionServerRenderingNoticePattern: RegExp =
  /^The pseudo class ":(first|nth|nth-last)-child" is potentially unsafe when doing server-side rendering\. /;

vi.spyOn(console, "error").mockImplementation((...args: unknown[]): void => {
  originalConsoleError(...args);
  if (
    args[0] ===
    "Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition."
  ) {
    unmountWarnings.push(args);
  }
  if (typeof args[0] === "string" && emotionServerRenderingNoticePattern.test(args[0])) {
    emotionServerRenderingNotices.push(args);
  }
});

vi.spyOn(console, "warn").mockImplementation((...args: unknown[]): void => {
  originalConsoleWarn(...args);
  if (
    args[0] ===
    "[jotai-devtools]: automatic tree-shaking in development mode is being deprecated. Make sure to tree-shake it out in your applications if you don't want it in production.\n\nFor more information, see https://github.com/jotaijs/jotai-devtools"
  ) {
    jotaiDeprecationWarnings.push(args);
  }
});

afterEach(() => {
  assert.deepEqual(unmountWarnings.splice(0), []);
  assert.deepEqual(jotaiDeprecationWarnings.splice(0), []);
  assert.deepEqual(emotionServerRenderingNotices.splice(0), []);
});
