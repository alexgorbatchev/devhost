import { expect, it } from "bun:test";
import { describeDemoMediaProblem } from "../describeDemoMediaProblem";

it("says nothing about a video that matches its pin", () => {
  expect(describeDemoMediaProblem({ name: "annotations.mp4", state: "current" })).toBeUndefined();
});

it.each([
  ["missing", "annotations.mp4 is not downloaded: run `just docs media`"],
  [
    "different",
    "annotations.mp4 is not the published video: publish this render with `just docs publish-media`, or delete it and run `just docs media`",
  ],
  ["unpinned", "annotations.mp4 is not published: run `just docs publish-media`"],
] as const)("names the command that resolves a %s video", (state, message) => {
  expect(describeDemoMediaProblem({ name: "annotations.mp4", state })).toBe(message);
});
