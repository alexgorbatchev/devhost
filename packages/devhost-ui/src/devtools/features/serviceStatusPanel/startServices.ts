import { START_SERVICE_PATH } from "../../shared/constants";
import { postControlAction } from "../../shared/postControlAction";
import type { FetchFunction } from "../../shared/pristineFetch";

/** Starts services the run left stopped, together with the services they depend on. */
export async function startServices(serviceNames: string[], request: FetchFunction): Promise<string | null> {
  return postControlAction(
    {
      path: START_SERVICE_PATH,
      body: JSON.stringify({ serviceNames }),
      failureLabel: `Failed to start ${serviceNames.join(", ")}`,
    },
    request,
  );
}
