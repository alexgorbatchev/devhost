import { describe, expect, it } from "bun:test";

import {
  marketingRecordingScenarios,
  readMarketingRecordingScenario,
  readRequestedMarketingRecordingScenarioIds,
} from "../marketingRecordingScenarios";

describe("marketingRecordingScenarios", () => {
  it("returns the known scenario metadata by id", () => {
    expect(readMarketingRecordingScenario("routing-health")?.recordingFileName).toBe("routing-health.json");
  });

  it("returns null for an unknown scenario", () => {
    expect(readMarketingRecordingScenario("unknown-scenario")).toBeNull();
  });

  it("parses requested scenario ids in order", () => {
    expect(readRequestedMarketingRecordingScenarioIds(["annotation", "sessions"])).toEqual(["annotation", "sessions"]);
  });

  it("rejects unknown requested scenario ids", () => {
    expect(() => {
      readRequestedMarketingRecordingScenarioIds(["unknown-scenario"]);
    }).toThrow("Unknown marketing recording scenario: unknown-scenario");
  });

  it("keeps all replay filenames unique", () => {
    expect(new Set(marketingRecordingScenarios.map((scenario) => scenario.recordingFileName)).size).toBe(
      marketingRecordingScenarios.length,
    );
  });
});
