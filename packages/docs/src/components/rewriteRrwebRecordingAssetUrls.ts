import { readResolvedRecordingUrl } from "./readResolvedRecordingUrl";

const staleXtermStylesheetUrlPattern = /http:\/\/127\.0\.0\.1:\d+\/__devhost__\/xterm\.css/g;

export function rewriteRrwebRecordingAssetUrls(recordingJsonText: string, baseUrl: string): string {
  const resolvedXtermStylesheetUrl: string = readResolvedRecordingUrl(baseUrl, "__devhost__/xterm.css");

  return recordingJsonText.replace(staleXtermStylesheetUrlPattern, resolvedXtermStylesheetUrl);
}
