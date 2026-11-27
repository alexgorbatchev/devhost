export { AnnotationSelectionOverlay } from "./components/AnnotationSelectionOverlay";
export {
  listAnnotationSelectionPlugins,
  readActiveAnnotationSelectionPlugin,
  registerAnnotationSelectionPlugin,
  subscribeToAnnotationSelectionPlugins,
  unregisterAnnotationSelectionPlugin,
} from "./annotationSelectionPluginRegistry";
export { createDomAnnotationSelectionCandidateForElement } from "./createDomAnnotationSelectionCandidateForElement";
export type { ISelectedAnnotationTarget } from "./annotationComposerModels";
export type {
  AnnotationSelectionIntent,
  IAnnotationSelectionCandidate,
  IAnnotationSelectionPlugin,
  IAnnotationSelectionPluginContext,
  IAnnotationSelectionPluginRegistry,
} from "./annotationSelectionPluginTypes";
