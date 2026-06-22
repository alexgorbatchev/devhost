import { DEVTOOLS_ROOT_ATTRIBUTE_NAME, DEVTOOLS_ROOT_ID } from "../../shared/constants";

import { readActiveAnnotationSelectionPlugin } from "./annotationSelectionPluginRegistry";
import type { AnnotationSelectionIntent, IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";

export async function resolveAnnotationSelectionCandidate(
  plugin: ReturnType<typeof readActiveAnnotationSelectionPlugin>,
  event: MouseEvent,
  intent: AnnotationSelectionIntent,
): Promise<IAnnotationSelectionCandidate | null> {
  try {
    const candidate = await plugin.resolveCandidate(event, intent, {
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

export function doesEventTargetAcceptTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

export function removeSelectionCursorStyle(styleId: string): void {
  document.getElementById(styleId)?.remove();
}
