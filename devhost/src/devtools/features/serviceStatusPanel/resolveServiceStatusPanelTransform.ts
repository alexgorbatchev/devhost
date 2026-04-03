export function resolveServiceStatusPanelTransform(
  panelSide: "left" | "right",
  isHovered: boolean,
  peekWidth: string,
): string {
  if (isHovered) {
    return "translateX(0)";
  }

  return panelSide === "left"
    ? `translateX(calc(-100% + ${peekWidth}))`
    : `translateX(calc(100% - ${peekWidth}))`;
}
