import { resolveHoverSlidePanelTransform } from "../../shared/resolveHoverSlidePanelTransform";
import type { PanelSide } from "./types";

export function resolveServiceStatusPanelTransform(
  panelSide: PanelSide,
  isHovered: boolean,
  peekWidth: string,
): string {
  return resolveHoverSlidePanelTransform(panelSide, isHovered, peekWidth);
}
