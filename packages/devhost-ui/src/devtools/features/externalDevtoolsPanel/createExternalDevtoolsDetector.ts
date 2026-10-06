import { createJotaiDevtoolsDetector } from "./createJotaiDevtoolsDetector";
import { createReactHookFormDevtoolsDetector } from "./createReactHookFormDevtoolsDetector";
import { createVueDevtoolsDetector } from "./createVueDevtoolsDetector";
import { externalDevtoolsDetectors } from "./externalDevtoolsDetectors";
import type { IExternalDevtoolsDetector } from "./types";

export function createExternalDevtoolsDetector(hostDocument: Document): IExternalDevtoolsDetector {
  const readFormAdapters = createReactHookFormDevtoolsDetector(hostDocument);
  const readJotaiAdapters = createJotaiDevtoolsDetector(hostDocument);
  const vueDetector = createVueDevtoolsDetector(hostDocument);
  return {
    readAdapters: () => [
      ...externalDevtoolsDetectors,
      ...readFormAdapters(),
      ...readJotaiAdapters(),
      ...vueDetector.readAdapters(),
    ],
    subscribe: (onChange) => vueDetector.subscribe(onChange),
  };
}
