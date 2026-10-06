import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./shared/constants";
import type { FetchFunction } from "./shared/pristineFetch";

export async function startDevtools(fetchConfiguration: FetchFunction, mount: () => void): Promise<void> {
  const response: Response = await fetchConfiguration("/__devhost__/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load devhost configuration (${response.status}).`);
  }
  const configuration: unknown = await response.json();
  if (
    typeof configuration !== "object" ||
    configuration === null ||
    typeof Reflect.get(configuration, "stackName") !== "string" ||
    Reflect.get(configuration, "stackName") === ""
  ) {
    throw new Error("Received invalid devhost configuration.");
  }
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, configuration);
  mount();
}
