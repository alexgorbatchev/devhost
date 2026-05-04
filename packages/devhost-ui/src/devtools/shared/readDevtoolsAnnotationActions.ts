import type { IAnnotationAction } from "./devtoolsConfig";
import { readInjectedDevtoolsConfig } from "./readInjectedDevtoolsConfig";

export function readDevtoolsAnnotationActions(): IAnnotationAction[] {
  return readInjectedDevtoolsConfig().annotationActions;
}
