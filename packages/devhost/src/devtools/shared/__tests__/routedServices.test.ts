import { describe, expect, test } from "bun:test";

import {
  createRoutedServiceKey,
  normalizeRoutedServicePath,
  resolveRoutedServiceForUrl,
  resolveRoutedServiceKeyForUrl,
  type IRoutedServiceIdentity,
} from "../routedServices";

const routedServices: IRoutedServiceIdentity[] = [
  { host: "app.localhost", path: "/", serviceName: "web" },
  { host: "app.localhost", path: "/api/*", serviceName: "api" },
  { host: "app.localhost", path: "/settings", serviceName: "settings" },
  { host: "admin.localhost", path: "/", serviceName: "admin" },
];

describe("routedServices", () => {
  test("normalizes root route paths", () => {
    expect(normalizeRoutedServicePath(undefined)).toBe("/");
    expect(normalizeRoutedServicePath(null)).toBe("/");
    expect(normalizeRoutedServicePath("/*")).toBe("/");
    expect(normalizeRoutedServicePath("/")).toBe("/");
  });

  test("resolves the most specific routed service for a url", () => {
    expect(resolveRoutedServiceForUrl(routedServices, "https://app.localhost/api/users")).toEqual({
      host: "app.localhost",
      path: "/api/*",
      serviceName: "api",
    });
    expect(resolveRoutedServiceForUrl(routedServices, "https://app.localhost/settings")).toEqual({
      host: "app.localhost",
      path: "/settings",
      serviceName: "settings",
    });
    expect(resolveRoutedServiceForUrl(routedServices, "https://app.localhost/dashboard")).toEqual({
      host: "app.localhost",
      path: "/",
      serviceName: "web",
    });
  });

  test("returns null when no routed service matches the url", () => {
    expect(resolveRoutedServiceForUrl(routedServices, "https://unknown.localhost/")).toBeNull();
    expect(resolveRoutedServiceForUrl(routedServices, "not-a-url")).toBeNull();
  });

  test("creates stable routed service keys", () => {
    expect(resolveRoutedServiceKeyForUrl(routedServices, "https://APP.localhost/api/users")).toBe(
      createRoutedServiceKey({ host: "app.localhost", path: "/api/*" }),
    );
  });
});
