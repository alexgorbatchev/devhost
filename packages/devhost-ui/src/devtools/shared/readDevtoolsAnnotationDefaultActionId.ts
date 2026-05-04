import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsAnnotationDefaultActionId(): string {
  return readInjectedDevtoolsConfig().annotationDefaultActionId;
}
