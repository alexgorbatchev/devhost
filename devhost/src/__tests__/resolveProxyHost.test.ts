import { describe, expect, test } from "bun:test";

import { formatProxyAddress, resolveProxyHost } from "../resolveProxyHost";

describe("resolveProxyHost", () => {
  test("maps wildcard bind hosts back to loopback proxy hosts", () => {
    expect(resolveProxyHost("127.0.0.1")).toBe("127.0.0.1");
    expect(resolveProxyHost("0.0.0.0")).toBe("127.0.0.1");
    expect(resolveProxyHost("::1")).toBe("::1");
    expect(resolveProxyHost("::")).toBe("::1");
  });

  test("formats IPv4 and IPv6 proxy addresses", () => {
    expect(formatProxyAddress("127.0.0.1", 3000)).toBe("127.0.0.1:3000");
    expect(formatProxyAddress("::1", 3000)).toBe("[::1]:3000");
  });
});
