export function resolveHoverSlidePanelTransform(isHovered: boolean, peekWidth: string): string {
  if (isHovered) {
    return "translateX(0)";
  }

  return `translateX(calc(100% - ${peekWidth}))`;
}
