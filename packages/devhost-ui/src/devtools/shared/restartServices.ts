import { RESTART_SERVICE_PATH } from "./constants";
import type { FetchFunction } from "./pristineFetch";
import { postControlAction } from "./postControlAction";

export async function restartServices(serviceNames: string[], request: FetchFunction): Promise<string | null> {
  return postControlAction(
    {
      path: RESTART_SERVICE_PATH,
      body: JSON.stringify({ serviceNames }),
      failureLabel: `Failed to restart ${serviceNames.join(", ")}`,
    },
    request,
  );
}
