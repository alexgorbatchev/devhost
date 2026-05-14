export { AnnotationComposer } from "./components/AnnotationComposer";
export { AnnotationMarkerList } from "./components/AnnotationMarkerList";
export { AnnotationSelectionOverlay } from "./components/AnnotationSelectionOverlay";
export {
  listAnnotationSelectionPlugins,
  readActiveAnnotationSelectionPlugin,
  registerAnnotationSelectionPlugin,
  subscribeToAnnotationSelectionPlugins,
  unregisterAnnotationSelectionPlugin,
} from "./annotationSelectionPluginRegistry";
export { createDomAnnotationSelectionCandidateForElement } from "./createDomAnnotationSelectionCandidateForElement";
export type { IAnnotationMarkerListItem } from "./components/AnnotationMarkerList";
export type { ISelectedAnnotationTarget } from "./annotationComposerModels";
export type {
  AnnotationSelectionIntent,
  IAnnotationSelectionCandidate,
  IAnnotationSelectionPlugin,
  IAnnotationSelectionPluginContext,
  IAnnotationSelectionPluginRegistry,
} from "./annotationSelectionPluginTypes";
