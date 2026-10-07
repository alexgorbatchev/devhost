import { describe, expect, test } from "bun:test";

import { fitTerminalSessionChips } from "../fitTerminalSessionChips";
import type { ITerminalSessionChipMeasurement } from "../types";

// Three chips of 100 with a gap of 4 are 308 wide. Folded, the "+N" control is 30 wide.
function measure(changes: Partial<ITerminalSessionChipMeasurement>): ITerminalSessionChipMeasurement {
  return {
    contentWidth: 308,
    fitKey: "a:running,b:running,c:running",
    gapWidth: 4,
    hiddenCount: 0,
    nextChipWidth: null,
    overflowWidth: 0,
    room: 308,
    visibleCount: 3,
    ...changes,
  };
}

describe("fitTerminalSessionChips", () => {
  test("keeps every chip while the content fits", () => {
    expect(fitTerminalSessionChips(measure({}), null)).toEqual({ failedFit: null, visibleLimit: 3 });
  });

  test("folds one chip when the content is wider than the room and remembers what did not fit", () => {
    expect(fitTerminalSessionChips(measure({ room: 250 }), null)).toEqual({
      failedFit: { fitKey: "a:running,b:running,c:running", room: 250, visibleLimit: 3 },
      visibleLimit: 2,
    });
  });

  test("stops folding when no chip is left, even though the control alone is too wide", () => {
    const measurement = measure({ contentWidth: 30, hiddenCount: 3, overflowWidth: 30, room: 20, visibleCount: 0 });

    expect(fitTerminalSessionChips(measurement, null)).toEqual({ failedFit: null, visibleLimit: 0 });
  });

  test("brings a folded chip back beside the control when it can fit", () => {
    // One chip and the control are 134 wide. A second chip adds 104 and narrows the control by 30 at most.
    const measurement = measure({
      contentWidth: 134,
      hiddenCount: 2,
      nextChipWidth: 100,
      overflowWidth: 30,
      visibleCount: 1,
    });

    expect(fitTerminalSessionChips({ ...measurement, room: 208 }, null).visibleLimit).toBe(2);
    expect(fitTerminalSessionChips({ ...measurement, room: 207 }, null).visibleLimit).toBe(1);
  });

  test("brings the last folded chip back in place of the control", () => {
    // Two chips and the control are 238 wide. The third chip replaces the control: 238 - 30 + 100.
    const measurement = measure({
      contentWidth: 238,
      hiddenCount: 1,
      nextChipWidth: 100,
      overflowWidth: 30,
      visibleCount: 2,
    });

    expect(fitTerminalSessionChips({ ...measurement, room: 308 }, null).visibleLimit).toBe(3);
    expect(fitTerminalSessionChips({ ...measurement, room: 307 }, null).visibleLimit).toBe(2);
  });

  test("does not retry a chip count that overflowed until the room grows or the chips change", () => {
    const measurement = measure({
      contentWidth: 134,
      hiddenCount: 2,
      nextChipWidth: 100,
      overflowWidth: 30,
      room: 220,
      visibleCount: 1,
    });
    const failedFit = { fitKey: measurement.fitKey, room: 220, visibleLimit: 2 };

    expect(fitTerminalSessionChips(measurement, failedFit)).toEqual({ failedFit, visibleLimit: 1 });
    expect(fitTerminalSessionChips({ ...measurement, room: 219 }, failedFit).visibleLimit).toBe(1);
    expect(fitTerminalSessionChips({ ...measurement, room: 221 }, failedFit).visibleLimit).toBe(2);
    expect(
      fitTerminalSessionChips({ ...measurement, fitKey: "a:exited,b:running,c:running" }, failedFit).visibleLimit,
    ).toBe(2);
  });

  test("still brings back fewer chips than the count that overflowed", () => {
    const measurement = measure({
      contentWidth: 30,
      hiddenCount: 3,
      nextChipWidth: 100,
      overflowWidth: 30,
      room: 220,
      visibleCount: 0,
    });
    const failedFit = { fitKey: measurement.fitKey, room: 220, visibleLimit: 2 };

    expect(fitTerminalSessionChips(measurement, failedFit).visibleLimit).toBe(1);
  });

  test("keeps the chips it has when the folded chip could not be measured", () => {
    const measurement = measure({
      contentWidth: 134,
      hiddenCount: 2,
      nextChipWidth: null,
      overflowWidth: 30,
      room: 900,
      visibleCount: 1,
    });

    expect(fitTerminalSessionChips(measurement, null).visibleLimit).toBe(1);
  });
});
