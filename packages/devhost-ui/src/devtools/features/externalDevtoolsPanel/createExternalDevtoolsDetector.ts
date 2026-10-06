import { createJotaiDevtoolsDetector } from "./createJotaiDevtoolsDetector";
import { createReactHookFormDevtoolsDetector } from "./createReactHookFormDevtoolsDetector";
import { createVueDevtoolsDetector } from "./createVueDevtoolsDetector";
import { createReduxDevtoolsDetector } from "../reduxDevtools/createReduxDevtoolsDetector";
import { externalDevtoolsDetectors } from "./externalDevtoolsDetectors";
import type { IExternalDevtoolsDetector } from "./types";

export function createExternalDevtoolsDetector(hostDocument: Document): IExternalDevtoolsDetector {
  const readFormAdapters = createReactHookFormDevtoolsDetector(hostDocument);
  const readJotaiAdapters = createJotaiDevtoolsDetector(hostDocument);
  const vueDetector = createVueDevtoolsDetector(hostDocument);
  const reduxDetector = createReduxDevtoolsDetector(hostDocument);
  return {
    readAdapters: () => [
      ...externalDevtoolsDetectors,
      ...readFormAdapters(),
      ...readJotaiAdapters(),
      ...vueDetector.readAdapters(),
      ...reduxDetector.readAdapters(),
    ],
    subscribe: (onChange) => {
      const unsubscribeVue = vueDetector.subscribe(onChange);
      const unsubscribeRedux = reduxDetector.subscribe(onChange);
      return () => {
        unsubscribeRedux();
        unsubscribeVue();
      };
    },
  };
}
