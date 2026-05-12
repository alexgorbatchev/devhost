export { AnnotationComposer } from "./AnnotationComposer";
export { AnnotationMarkerList } from "./AnnotationMarkerList";
export { AnnotationSelectionOverlay } from "./AnnotationSelectionOverlay";
export {
  listAnnotationSelectionPlugins,
  readActiveAnnotationSelectionPlugin,
  registerAnnotationSelectionPlugin,
  subscribeToAnnotationSelectionPlugins,
  unregisterAnnotationSelectionPlugin,
} from "./annotationSelectionPluginRegistry";
export { createDomAnnotationSelectionCandidateForElement } from "./createDomAnnotationSelectionCandidateForElement";
export type { IAnnotationMarkerListItem } from "./AnnotationMarkerList";
export type { ISelectedAnnotationTarget } from "./annotationComposerModels";
export type {
  AnnotationSelectionIntent,
  IAnnotationSelectionCandidate,
  IAnnotationSelectionPlugin,
  IAnnotationSelectionPluginContext,
  IAnnotationSelectionPluginRegistry,
} from "./annotationSelectionPluginTypes";
