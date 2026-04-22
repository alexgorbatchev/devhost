import type { IRoutedServiceIdentity } from "./routedServices";
import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsRoutedServices(): IRoutedServiceIdentity[] {
  return readInjectedDevtoolsConfig().routedServices;
}
