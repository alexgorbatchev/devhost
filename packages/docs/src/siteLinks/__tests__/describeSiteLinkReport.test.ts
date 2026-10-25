import { expect, it } from "bun:test";
import { describeSiteLinkReport } from "../describeSiteLinkReport";

it("says where each broken link is and how to fix an unreached page", () => {
  expect(
    describeSiteLinkReport({
      broken: [{ page: "/devhost/guides/one/", url: "/devhost/guides/two/#usage", reason: "HTTP 404" }],
      unreachedPages: ["/devhost/guides/orphan/"],
    }),
  ).toEqual([
    "/devhost/guides/one/ links to /devhost/guides/two/#usage: HTTP 404",
    "/devhost/guides/orphan/ is not linked from any page; add it to the sidebar in astro.config.mjs",
  ]);
});

it("says nothing about a site whose links all resolve", () => {
  expect(describeSiteLinkReport({ broken: [], unreachedPages: [] })).toEqual([]);
});
