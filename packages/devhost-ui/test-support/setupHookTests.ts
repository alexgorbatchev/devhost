import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

// Testing Library registers these itself only where the runner exposes its hooks as globals, which Vitest does not.
beforeAll((): void => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach((): void => {
  cleanup();
  document.body.replaceChildren();
});
