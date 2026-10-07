import { expect, it } from "bun:test";
import { createCaptions } from "../createCaptions";

it("offsets scene captions using the measured clip durations", () => {
  expect(
    createCaptions([
      { caption: "Start your stack", duration: 1.25 },
      { caption: "Restart a service", duration: 2.5 },
    ]),
  ).toBe("1\n00:00:00,000 --> 00:00:01,250\nStart your stack\n\n2\n00:00:01,250 --> 00:00:03,750\nRestart a service\n");
});

it("carries fractional seconds into the next minute", () => {
  expect(
    createCaptions([
      { caption: "First", duration: 59.9996 },
      { caption: "Second", duration: 1 },
    ]),
  ).toBe("1\n00:00:00,000 --> 00:01:00,000\nFirst\n\n2\n00:01:00,000 --> 00:01:01,000\nSecond\n");
});

it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid duration %s", (duration) => {
  expect(() => createCaptions([{ caption: "Scene", duration }])).toThrow("Clip duration must be finite and positive");
});
