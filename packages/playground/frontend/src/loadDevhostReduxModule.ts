import type { IDevhostReduxModule } from "./types";

// devhost serves its Redux inspector registration module beside the page, on the page's own route.
const DEVHOST_REDUX_MODULE_URL = "/__devhost__/redux.js";

function isDevhostReduxModule(value: unknown): value is IDevhostReduxModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerReduxDevtoolsStore" in value &&
    typeof value.registerReduxDevtoolsStore === "function" &&
    "registerZustandDevtoolsStore" in value &&
    typeof value.registerZustandDevtoolsStore === "function"
  );
}

// Loads the registration module devhost serves. It exists only when devhost serves the page, so this rejects
// otherwise.
export async function loadDevhostReduxModule(): Promise<IDevhostReduxModule> {
  // The browser resolves this URL at run time; the playground's bundle does not contain the module.
  const loadedModule: unknown = await import(DEVHOST_REDUX_MODULE_URL);
  if (!isDevhostReduxModule(loadedModule)) {
    throw new Error(`${DEVHOST_REDUX_MODULE_URL} does not export devhost's store registration functions.`);
  }
  return loadedModule;
}
