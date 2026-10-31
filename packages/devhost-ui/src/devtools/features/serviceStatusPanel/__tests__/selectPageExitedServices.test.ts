import { describe, expect, test } from "bun:test";

import type { ServiceHealth } from "../../../shared/types";
import { selectPageExitedServices } from "../selectPageExitedServices";

const exited = (name: string): ServiceHealth => ({ exitCode: 1, managed: true, name, status: false });
const services: ServiceHealth[] = [exited("web"), exited("api"), exited("storybook")];
const route = { host: "app.localhost", path: "/", serviceName: "web" };

describe("selectPageExitedServices", () => {
  test("keeps the page's own service", () => {
    expect(selectPageExitedServices(services, route)).toEqual([exited("web")]);
  });

  test("keeps the services the page's service depends on", () => {
    expect(selectPageExitedServices(services, { ...route, dependencies: ["api"] })).toEqual([
      exited("web"),
      exited("api"),
    ]);
  });

  test("leaves out an exit unrelated to the page", () => {
    expect(selectPageExitedServices([exited("storybook")], { ...route, dependencies: ["api"] })).toEqual([]);
  });

  test("leaves out every exit on a page no route owns", () => {
    expect(selectPageExitedServices(services, null)).toEqual([]);
  });
});
