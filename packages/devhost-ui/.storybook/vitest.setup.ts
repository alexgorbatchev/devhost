import "../src/devtools/shared/devtools.css";
import { afterEach, assert, vi } from "vitest";

const originalConsoleError = console.error;
const unmountWarnings: unknown[][] = [];

vi.spyOn(console, "error").mockImplementation((...args: unknown[]): void => {
  originalConsoleError(...args);
  if (
    args[0] ===
    "Attempted to synchronously unmount a root while React was already rendering. React cannot finish unmounting the root until the current render has completed, which may lead to a race condition."
  ) {
    unmountWarnings.push(args);
  }
});

afterEach(() => {
  assert.deepEqual(unmountWarnings.splice(0), []);
});
