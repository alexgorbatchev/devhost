import type { IRrwebDemoRecording } from "./createRrwebDemoRecording";

export function exportRrwebDemoRecording(recording: IRrwebDemoRecording): void {
  const recordingJson = JSON.stringify(recording, null, 2);
  const recordingBlob = new Blob([recordingJson], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(recordingBlob);
  const linkElement = document.createElement("a");

  linkElement.href = downloadUrl;
  linkElement.download = createRrwebDemoRecordingFileName();
  linkElement.hidden = true;

  document.body.append(linkElement);
  linkElement.click();
  linkElement.remove();

  window.setTimeout((): void => {
    URL.revokeObjectURL(downloadUrl);
  }, 0);
}

function createRrwebDemoRecordingFileName(): string {
  const isoTimestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");

  return `rrweb-demo-recording-${isoTimestamp}.json`;
}
