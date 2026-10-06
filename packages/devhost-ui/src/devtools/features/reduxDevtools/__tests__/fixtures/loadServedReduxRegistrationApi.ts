import type { IReduxHostRegistrationApi } from "./types";

function isRegistrationApi(value: unknown): value is IReduxHostRegistrationApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerReduxDevtoolsStore" in value &&
    typeof value.registerReduxDevtoolsStore === "function" &&
    "registerZustandDevtoolsStore" in value &&
    typeof value.registerZustandDevtoolsStore === "function"
  );
}

export async function loadServedReduxRegistrationApi(): Promise<IReduxHostRegistrationApi> {
  // The host opts into devhost's actual browser module; its own bundler need not publish this private UI workspace.
  const moduleUrl: string = "/__devhost__/redux.js";
  const api: unknown = await import(moduleUrl);
  if (!isRegistrationApi(api)) throw new Error("The served Redux host registration module is unavailable.");
  return api;
}
