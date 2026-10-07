import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, vi, type MockInstance } from "vitest";

let consoleError: MockInstance<typeof console.error>;

// Testing Library registers these itself only where the runner exposes its hooks as globals, which Vitest does not.
beforeAll((): void => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

// React reports a state update outside `act`, and its other development warnings, through `console.error`. The
// runner prints those and passes anyway, so a test that causes one fails here.
beforeEach((): void => {
  consoleError = vi.spyOn(console, "error");
});

afterEach((): void => {
  cleanup();
  document.body.replaceChildren();

  const reportedErrors: unknown[][] = consoleError.mock.calls;

  consoleError.mockRestore();
  expect(reportedErrors).toEqual([]);
});
