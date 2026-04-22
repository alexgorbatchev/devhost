import { resolveHoverSlidePanelTransform } from "../../shared/resolveHoverSlidePanelTransform";

export function resolveServiceStatusPanelTransform(isHovered: boolean, peekWidth: string): string {
  return resolveHoverSlidePanelTransform(isHovered, peekWidth);
}
