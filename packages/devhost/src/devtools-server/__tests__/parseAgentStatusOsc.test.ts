import { describe, expect, test } from "bun:test";

import { parseAgentStatusOsc } from "../parseAgentStatusOsc";

describe("parseAgentStatusOsc", () => {
  test("parses a single complete working sequence", () => {
    expect(parseAgentStatusOsc("", "\u001b]1337;SetAgentStatus=working\u0007")).toEqual({
      carryover: "",
      statuses: ["working"],
    });
  });

  test("parses a single complete finished sequence", () => {
    expect(parseAgentStatusOsc("", "\u001b]1337;SetAgentStatus=finished\u0007")).toEqual({
      carryover: "",
      statuses: ["finished"],
    });
  });

  test("parses multiple sequences in one chunk", () => {
    expect(
      parseAgentStatusOsc(
        "",
        "before\u001b]1337;SetAgentStatus=working\u0007middle\u001b]1337;SetAgentStatus=finished\u0007after",
      ),
    ).toEqual({
      carryover: "after",
      statuses: ["working", "finished"],
    });
  });

  test("parses a prefix split across chunks", () => {
    const firstChunk = parseAgentStatusOsc("", "noise\u001b]1337;SetAgentSta");

    expect(firstChunk).toEqual({
      carryover: "oise\u001b]1337;SetAgentSta",
      statuses: [],
    });

    expect(parseAgentStatusOsc(firstChunk.carryover, "tus=working\u0007")).toEqual({
      carryover: "",
      statuses: ["working"],
    });
  });

  test("parses a terminator split across chunks", () => {
    const firstChunk = parseAgentStatusOsc("", "\u001b]1337;SetAgentStatus=finished\u001b");

    expect(firstChunk).toEqual({
      carryover: "\u001b]1337;SetAgentStatus=finished\u001b",
      statuses: [],
    });

    expect(parseAgentStatusOsc(firstChunk.carryover, "\\tail")).toEqual({
      carryover: "tail",
      statuses: ["finished"],
    });
  });

  test("accepts BEL and ST terminators", () => {
    expect(
      parseAgentStatusOsc("", "\u001b]1337;SetAgentStatus=working\u0007\u001b]1337;SetAgentStatus=finished\u001b\\"),
    ).toEqual({
      carryover: "",
      statuses: ["working", "finished"],
    });
  });

  test("ignores unrelated OSC sequences", () => {
    expect(parseAgentStatusOsc("", "\u001b]1337;Other=value\u0007hello").statuses).toEqual([]);
  });
});
