import { DEVHOST_SERVICE_NAME, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./constants";

export function readDevtoolsStackName(): string {
  const injectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

  if (typeof injectedConfig !== "object" || injectedConfig === null) {
    return DEVHOST_SERVICE_NAME;
  }

  const stackName: unknown = Reflect.get(injectedConfig, "stackName");

  return typeof stackName === "string" && stackName.length > 0 ? stackName : DEVHOST_SERVICE_NAME;
}
