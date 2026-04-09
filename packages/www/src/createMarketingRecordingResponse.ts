import path from "node:path";

const marketingRecordingRelativePaths: Record<string, string> = {
  "/recordings/marketing/annotation.json": "recordings/marketing/annotation.json",
};

export async function createMarketingRecordingResponse(
  requestPathname: string,
  publicRootPath: string,
): Promise<Response | null> {
  const relativeRecordingPath: string | undefined = marketingRecordingRelativePaths[requestPathname];

  if (relativeRecordingPath === undefined) {
    return null;
  }

  const recordingFile = Bun.file(path.join(publicRootPath, relativeRecordingPath));

  if (!(await recordingFile.exists())) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(recordingFile, {
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
