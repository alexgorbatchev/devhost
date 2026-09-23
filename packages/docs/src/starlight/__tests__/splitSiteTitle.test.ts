import { describe, expect, it } from "bun:test";

import { splitSiteTitle } from "../splitSiteTitle";

describe("splitSiteTitle", () => {
  it("splits a scoped package title into its scope and package name", () => {
    expect(splitSiteTitle("@alexgorbatchev/devhost")).toEqual({ scope: "@alexgorbatchev/", name: "devhost" });
  });

  it("keeps an unscoped title whole", () => {
    expect(splitSiteTitle("devhost")).toEqual({ scope: "", name: "devhost" });
  });

  it("splits on the last slash so nested scopes stay in the scope part", () => {
    expect(splitSiteTitle("@org/tools/devhost")).toEqual({ scope: "@org/tools/", name: "devhost" });
  });
});
