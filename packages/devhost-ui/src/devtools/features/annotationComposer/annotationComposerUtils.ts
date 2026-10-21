import { DEVTOOLS_ROOT_ATTRIBUTE_NAME, DEVTOOLS_ROOT_ID } from "../../shared/constants";

import { readActiveAnnotationSelectionPlugin } from "./annotationSelectionPluginRegistry";
import type { AnnotationSelectionIntent, IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";
import { defaultDomAnnotationSelectionPlugin } from "./defaultDomAnnotationSelectionPlugin";
import { isAnnotationControlsEvent } from "./isAnnotationControlsEvent";

export async function resolveAnnotationSelectionCandidate(
  plugin: ReturnType<typeof readActiveAnnotationSelectionPlugin>,
  event: MouseEvent,
  intent: AnnotationSelectionIntent,
): Promise<IAnnotationSelectionCandidate | null> {
  if (isAnnotationControlsEvent(event)) return null;
  // Host plugins describe host surfaces. Devhost's own controls always use the DOM selector.
  const selector = event.composedPath().some(isInteractionInsideDevtools)
    ? defaultDomAnnotationSelectionPlugin
    : plugin;
  try {
    const candidate = await selector.resolveCandidate(event, intent, {
      isDevtoolsEventTarget: isInteractionInsideDevtools,
    });

    return candidate ?? null;
  } catch {
    return null;
  }
}

export function isInteractionInsideDevtools(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest(`[${DEVTOOLS_ROOT_ATTRIBUTE_NAME}], #${DEVTOOLS_ROOT_ID}`) !== null;
}

export function removeSelectionCursorStyle(styleId: string): void {
  document.getElementById(styleId)?.remove();
}
