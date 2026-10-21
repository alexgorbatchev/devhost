/** Annotation tools remain actionable while every other devhost surface can be selected. */
export function isAnnotationControlsEvent(event: Event): boolean {
  return event
    .composedPath()
    .some((target) => target instanceof Element && target.closest("[data-devhost-annotation-controls]") !== null);
}
