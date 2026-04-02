import type { CSSObject } from "@emotion/css/create-instance";

import type { DevtoolsMinimapPosition, DevtoolsPosition } from "../../stackTypes";
import type { IDevtoolsTheme } from "./devtoolsTheme";

interface ICreateCornerDockStyleOptions {
  devtoolsMinimapPosition: DevtoolsMinimapPosition;
  devtoolsPosition: DevtoolsPosition;
  hasVisibleMinimap: boolean;
}

export function createCornerDockStyle(
  theme: IDevtoolsTheme,
  options: ICreateCornerDockStyleOptions,
): CSSObject {
  const verticalPositionStyle: CSSObject =
    options.devtoolsPosition === "top-left" || options.devtoolsPosition === "top-right"
      ? { top: theme.spacing.sm }
      : { bottom: theme.spacing.sm };
  const horizontalPositionStyle: CSSObject = createHorizontalPositionStyle(theme, options);

  return {
    ...verticalPositionStyle,
    ...horizontalPositionStyle,
    position: "fixed",
    zIndex: theme.zIndices.floating,
    display: "grid",
    gap: theme.spacing.xxs,
    width: "fit-content",
    maxWidth: createCornerDockMaxWidth(theme, options.hasVisibleMinimap),
    pointerEvents: "auto",
  };
}

function createCornerDockMaxWidth(theme: IDevtoolsTheme, hasVisibleMinimap: boolean): string {
  if (!hasVisibleMinimap) {
    return "calc(100vw - 20px)";
  }

  return `calc(100vw - 20px - ${theme.sizes.logMinimapPeekWidth} - ${theme.spacing.xxs})`;
}

function createHorizontalPositionStyle(
  theme: IDevtoolsTheme,
  options: ICreateCornerDockStyleOptions,
): CSSObject {
  const panelSide: DevtoolsMinimapPosition =
    options.devtoolsPosition === "top-left" || options.devtoolsPosition === "bottom-left"
      ? "left"
      : "right";
  const baseOffset: string = theme.spacing.sm;

  if (!options.hasVisibleMinimap || panelSide !== options.devtoolsMinimapPosition) {
    return panelSide === "left" ? { left: baseOffset } : { right: baseOffset };
  }

  const shiftedOffset: string =
    `calc(${baseOffset} + ${theme.sizes.logMinimapPeekWidth} + ${theme.spacing.xxs})`;

  return panelSide === "left" ? { left: shiftedOffset } : { right: shiftedOffset };
}
