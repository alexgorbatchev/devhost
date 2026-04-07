import type { PanelSide } from "./types";

export function resolveServiceStatusPanelTransform(
  panelSide: PanelSide,
  isHovered: boolean,
  peekWidth: string,
): string {
  if (isHovered) {
    return "translateX(0)";
  }

  return panelSide === "left" ? `translateX(calc(-100% + ${peekWidth}))` : `translateX(calc(100% - ${peekWidth}))`;
}
