import { describe, expect, it } from "bun:test";

import { rewriteRrwebRecordingAssetUrls } from "../rewriteRrwebRecordingAssetUrls";

describe("rewriteRrwebRecordingAssetUrls", () => {
  it("rewrites recorded xterm stylesheet URLs to the docs base path", () => {
    const recordingJsonText =
      '{"events":[{"data":{"href":"http://127.0.0.1:34685/__devhost__/xterm.css"}}],"durationMs":1000}';

    expect(rewriteRrwebRecordingAssetUrls(recordingJsonText, "/devhost/")).toBe(
      '{"events":[{"data":{"href":"/devhost/__devhost__/xterm.css"}}],"durationMs":1000}',
    );
  });

  it("preserves recordings that do not reference the temporary xterm stylesheet URL", () => {
    const recordingJsonText = '{"events":[{"data":{"href":"/devhost/recordings/marketing/annotation.json"}}]}';

    expect(rewriteRrwebRecordingAssetUrls(recordingJsonText, "/devhost/")).toBe(recordingJsonText);
  });
});
