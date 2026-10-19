import { expect, test } from "bun:test";

import { updateInjectedConfig } from "../updateInjectedConfig";

test("replaces the configuration with the one devhost sends", () => {
  const config = { stackName: "before", minimapEnabled: true, routedServices: [] };
  const sent = {
    stackName: "after",
    minimapEnabled: false,
    routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }],
  };

  expect(updateInjectedConfig(sent, config)).toBe(sent);
  // The previous configuration object is left as it was; readers tell a change by the object's identity.
  expect(config).toEqual({ stackName: "before", minimapEnabled: true, routedServices: [] });
});

test("keeps the same configuration object while devhost sends the same configuration", () => {
  const config = { stackName: "shop", routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }] };

  expect(
    updateInjectedConfig(
      { stackName: "shop", routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }] },
      config,
    ),
  ).toBe(config);
});

test("health without a configuration keeps the current one", () => {
  const config = { stackName: "shop" };

  expect(updateInjectedConfig(undefined, config)).toBe(config);
});

test("a page that loaded no configuration takes the one devhost sends", () => {
  const sent = { stackName: "shop" };

  expect(updateInjectedConfig(sent, undefined)).toBe(sent);
});
