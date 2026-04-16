import path from "node:path";

const marketingRecordingRequestPathPrefix: string = "/recordings/marketing/";
const marketingRecordingRootRelativePath: string = "recordings/marketing";

export async function createMarketingRecordingResponse(
  requestPathname: string,
  publicRootPath: string,
): Promise<Response | null> {
  if (!requestPathname.startsWith(marketingRecordingRequestPathPrefix) || !requestPathname.endsWith(".json")) {
    return null;
  }

  const relativeRecordingFileName: string = requestPathname.slice(marketingRecordingRequestPathPrefix.length);

  if (!isSingleFileName(relativeRecordingFileName)) {
    return new Response("Not Found", { status: 404 });
  }

  const marketingRecordingRootPath: string = path.resolve(publicRootPath, marketingRecordingRootRelativePath);
  const recordingFilePath: string = path.resolve(marketingRecordingRootPath, relativeRecordingFileName);

  if (!isPathInsideDirectory(recordingFilePath, marketingRecordingRootPath)) {
    return new Response("Not Found", { status: 404 });
  }

  const recordingFile = Bun.file(recordingFilePath);

  if (!(await recordingFile.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(recordingFile, {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  return filePath === directoryPath || filePath.startsWith(`${directoryPath}${path.sep}`);
}

function isSingleFileName(fileName: string): boolean {
  return fileName.length > 0 && !fileName.includes("/") && !fileName.includes("\\");
}
