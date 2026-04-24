export function readResolvedRecordingUrl(baseUrl: string, recordingUrl: string): string {
  if (recordingUrl.startsWith("http://") || recordingUrl.startsWith("https://") || recordingUrl.startsWith("//")) {
    return recordingUrl;
  }

  if (recordingUrl.startsWith("/")) {
    return recordingUrl;
  }

  const normalizedBaseUrl: string = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedRecordingUrl: string = recordingUrl.replace(/^\.\//, "");

  return `${normalizedBaseUrl}${normalizedRecordingUrl}`;
}
