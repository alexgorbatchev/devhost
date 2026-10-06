import { expect, test } from "bun:test";

import { resolveRoutedServiceKeyForUrl } from "../../../shared/routedServices";
import { updateInjectedRouting } from "../updateInjectedRouting";

test("updates route matching and primary service while retaining the stack identity", () => {
  const config = {
    stackName: "retained",
    primaryService: "web",
    routedServices: [{ host: "old.localhost", path: "/", serviceName: "web" }],
  };
  updateInjectedRouting(
    { primaryService: "worker", routedServices: [{ host: "new.localhost", path: "/api/*", serviceName: "worker" }] },
    config,
  );
  expect(resolveRoutedServiceKeyForUrl(config.routedServices, "https://old.localhost/")).toBeNull();
  expect(resolveRoutedServiceKeyForUrl(config.routedServices, "https://new.localhost/api/orders")).toBe("worker");
  expect(config.primaryService).toBe("worker");
  expect(config.stackName).toBe("retained");
  updateInjectedRouting({ primaryService: "", routedServices: [] }, config);
  expect(resolveRoutedServiceKeyForUrl(config.routedServices, "https://new.localhost/api/orders")).toBeNull();
  expect(config.primaryService).toBe("");
});

test("health without routing retains the current routing", () => {
  const config = { primaryService: "web", routedServices: [{ host: "app.localhost", path: "/", serviceName: "web" }] };
  updateInjectedRouting(undefined, config);
  expect(resolveRoutedServiceKeyForUrl(config.routedServices, "https://app.localhost/")).toBe("web");
  expect(config.primaryService).toBe("web");
  updateInjectedRouting({ primaryService: "web", routedServices: [] }, undefined);
});
