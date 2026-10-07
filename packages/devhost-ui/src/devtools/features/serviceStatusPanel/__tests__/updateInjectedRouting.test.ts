import { expect, test } from "bun:test";

import { updateInjectedRouting } from "../updateInjectedRouting";

test("applies new routing to a copy and retains the other settings", () => {
  const config = {
    stackName: "retained",
    primaryService: "web",
    routedServices: [{ host: "old.localhost", path: "/", serviceName: "web" }],
  };

  expect(
    updateInjectedRouting(
      { primaryService: "worker", routedServices: [{ host: "new.localhost", path: "/api/*", serviceName: "worker" }] },
      config,
    ),
  ).toEqual({
    stackName: "retained",
    primaryService: "worker",
    routedServices: [{ host: "new.localhost", path: "/api/*", serviceName: "worker" }],
  });
  // The previous configuration object is left as it was; readers tell a change by the object's identity.
  expect(config).toEqual({
    stackName: "retained",
    primaryService: "web",
    routedServices: [{ host: "old.localhost", path: "/", serviceName: "web" }],
  });
});

test("clears routing when the stack reports none", () => {
  const config = { primaryService: "web", routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }] };

  expect(updateInjectedRouting({ primaryService: "", routedServices: [] }, config)).toEqual({
    primaryService: "",
    routedServices: [],
  });
});

test("keeps the same configuration object while routing is unchanged", () => {
  const config = { primaryService: "web", routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }] };

  expect(
    updateInjectedRouting(
      { primaryService: "web", routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }] },
      config,
    ),
  ).toBe(config);
});

test("health without routing keeps the current configuration", () => {
  const config = { primaryService: "web", routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }] };

  expect(updateInjectedRouting(undefined, config)).toBe(config);
});

test("leaves an unavailable configuration unavailable", () => {
  expect(updateInjectedRouting({ primaryService: "web", routedServices: [] }, undefined)).toBeUndefined();
});
