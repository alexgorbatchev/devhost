import { removeNativeReactAssets } from "./removeNativeReactAssets";

export async function finishNativeReactCleanup(
  directoryPath: string,
  outputPath: string,
  failure: unknown,
  cleanup: PromiseSettledResult<unknown>[],
): Promise<unknown> {
  const cleanupErrors = cleanup.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (cleanupErrors.length === 0) {
    try {
      await removeNativeReactAssets(directoryPath, outputPath);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length > 0)
    return new AggregateError(
      failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
      "Native acceptance resource cleanup failed.",
    );
  return failure;
}
