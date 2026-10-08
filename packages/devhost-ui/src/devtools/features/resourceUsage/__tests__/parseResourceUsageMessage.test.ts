import { describe, expect, test } from "bun:test";

import { parseResourceUsageMessage } from "../parseResourceUsageMessage";

describe("parseResourceUsageMessage", () => {
  test("reads every readout the server sends", () => {
    const usage = {
      cpu: { percent: 18.4, cores: 8 },
      memory: { percent: 57.7, usedBytes: 20_379_824_128, totalBytes: 35_324_952_576 },
      disk: { percent: 90.6, usedBytes: 188_374_353_408, totalBytes: 207_851_412_992 },
    };

    expect(parseResourceUsageMessage(JSON.stringify(usage))).toEqual(usage);
  });

  test("reads a message without the readouts that are off or have no reading", () => {
    expect(parseResourceUsageMessage(JSON.stringify({ cpu: { percent: 3, cores: 2 } }))).toEqual({
      cpu: { percent: 3, cores: 2 },
    });
    expect(parseResourceUsageMessage("{}")).toEqual({});
  });

  test.each([
    ["a binary frame", new ArrayBuffer(1)],
    ["text that is not JSON", "{"],
    ["a JSON value that is not an object", "[]"],
    ["a readout that is not an object", JSON.stringify({ cpu: 18 })],
    ["a percentage that is not a number", JSON.stringify({ cpu: { percent: "18", cores: 8 } })],
    ["a percentage that is not finite", '{"memory":{"percent":1e999,"usedBytes":1,"totalBytes":2}}'],
    ["a space readout without its byte counts", JSON.stringify({ disk: { percent: 40 } })],
  ])("rejects %s", (_name: string, frame: unknown) => {
    expect(parseResourceUsageMessage(frame)).toBeNull();
  });
});
