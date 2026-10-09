import { expect, it } from "bun:test";
import { planPromoFootage } from "../planPromoFootage";
import type { IPromoFootageSlot } from "../types";

const slot: IPromoFootageSlot = {
  id: "agent-working",
  sourceId: "annotations-2",
  outputPath: "assets/footage/agent-working.mp4",
  duration: 4,
  from: 0,
  to: undefined,
};

it("time-lapses a recording that runs longer than its slot", () => {
  expect(planPromoFootage(slot, 30)).toEqual({ startSeconds: 0, sourceSeconds: 30, speed: 7.5, holdSeconds: 0 });
});

it("plays a shorter recording at its real speed and holds its last frame", () => {
  expect(planPromoFootage(slot, 2.5)).toEqual({ startSeconds: 0, sourceSeconds: 2.5, speed: 1, holdSeconds: 1.5 });
});

it("fits only the window between a start offset and an offset from the end", () => {
  expect(planPromoFootage({ ...slot, from: 1, to: -5 }, 14)).toEqual({
    startSeconds: 1,
    sourceSeconds: 8,
    speed: 2,
    holdSeconds: 0,
  });
});

it("takes the last seconds of a recording whose length varies between runs", () => {
  expect(planPromoFootage({ ...slot, duration: 1, from: -2.5 }, 40)).toEqual({
    startSeconds: 37.5,
    sourceSeconds: 2.5,
    speed: 2.5,
    holdSeconds: 0,
  });
});

it("holds the last frame when the recording ends before the requested window does", () => {
  expect(planPromoFootage({ ...slot, from: 0, to: 3 }, 2)).toEqual({
    startSeconds: 0,
    sourceSeconds: 2,
    speed: 1,
    holdSeconds: 2,
  });
});

it("rejects a window that lies outside the recording", () => {
  expect(() => planPromoFootage({ ...slot, from: 3, to: -3 }, 6)).toThrow(
    "Footage annotations-2 lasts 6s, which leaves nothing between 3s and 3s for agent-working",
  );
});
