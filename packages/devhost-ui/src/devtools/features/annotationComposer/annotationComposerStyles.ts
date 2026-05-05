import type { CSSObject } from "@emotion/css/create-instance";

import type { IDevtoolsTheme } from "../../shared";

import { markerSize, popupWidth, type IMarkerRenderModel } from "./annotationComposerModels";
import type { IRectSnapshot } from "./types";

interface ISelectionHighlightFrame {
  height: number;
  left: number;
  top: number;
  width: number;
}

const selectionHighlightHorizontalPadding: number = 2;
const selectionHighlightVerticalPadding: number = 1;
const actionButtonMutedForeground: string = "rgba(255, 255, 255, 0.6)";
const actionButtonShortcutBackground: string = "rgba(255, 255, 255, 0.1)";
const actionButtonSubmitForeground: string = "rgba(255, 255, 255, 1)";
const actionButtonHoverRing: string = "rgba(255, 255, 255, 0.22)";

export const overlayStyle: CSSObject = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
};

export const popupHeaderStyle: CSSObject = {
  display: "grid",
  gap: "4px",
};

export const popupMetaStyle: CSSObject = {
  fontSize: "12px",
  opacity: 0.72,
};

export const popupActionsStyle: CSSObject = {
  display: "flex",
  justifyContent: "flex-start",
  gap: "8px",
};

export const shortcutBadgeHoverStyle: CSSObject = {
  color: "rgba(255, 255, 255, 1)",
};

export function createSubmissionErrorStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1.4,
  };
}

export function createActionButtonHoverStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${actionButtonSubmitForeground}`,
    boxShadow: `0 0 0 1px ${actionButtonHoverRing}, ${theme.shadows.floating}`,
    color: actionButtonSubmitForeground,
  };
}

export function createCancelButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${theme.colors.border}`,
    boxShadow: theme.shadows.floating,
    color: actionButtonMutedForeground,
  };
}

export function createShortcutBadgeStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    minWidth: "32px",
    padding: `0 ${theme.spacing.xs}`,
    border: "none",
    borderRadius: theme.radii.sm,
    background: actionButtonShortcutBackground,
    color: actionButtonMutedForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: "80%",
    lineHeight: 1.6,
    boxSizing: "border-box",
  };
}

export function createSubmitButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${theme.colors.selectionBorder}`,
    boxShadow: theme.shadows.floating,
    background: theme.colors.selectionBackground,
    color: actionButtonSubmitForeground,
  };
}

export function createHoverHighlightStyle(theme: IDevtoolsTheme, hoveredRectangle: IRectSnapshot): CSSObject {
  return createSelectionHighlightFrameStyle(theme, {
    height: hoveredRectangle.height,
    left: hoveredRectangle.x,
    top: hoveredRectangle.y,
    width: hoveredRectangle.width,
  });
}

export function createSelectionHighlightStyle(theme: IDevtoolsTheme, marker: IMarkerRenderModel): CSSObject {
  return createSelectionHighlightFrameStyle(theme, {
    height: marker.elementHeight,
    left: marker.elementLeft,
    top: marker.elementTop,
    width: marker.elementWidth,
  });
}

export function createMarkerStyle(theme: IDevtoolsTheme, marker: IMarkerRenderModel): CSSObject {
  return {
    position: "fixed",
    top: marker.markerTop,
    left: marker.markerLeft,
    width: `${markerSize}px`,
    height: `${markerSize}px`,
    display: "grid",
    placeItems: "center",
    borderRadius: theme.radii.pill,
    background: theme.colors.accentBackground,
    color: theme.colors.accentForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    fontWeight: 700,
    boxShadow: theme.shadows.floating,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

export function createPopupStyle(theme: IDevtoolsTheme, left: number, top: number): CSSObject {
  return {
    position: "fixed",
    top,
    left,
    width: `min(${popupWidth}px, calc(100vw - ${theme.spacing.sm} - ${theme.spacing.sm}))`,
    display: "grid",
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: theme.colors.background,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.body,
    fontSize: theme.fontSizes.sm,
    boxShadow: theme.shadows.popup,
    pointerEvents: "auto",
    zIndex: theme.zIndices.floating,
  };
}

export function createTextareaStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    width: "100%",
    minHeight: "96px",
    resize: "none",
    boxSizing: "border-box",
    padding: theme.spacing.xs,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    background: theme.colors.background,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.body,
    fontSize: theme.fontSizes.sm,
  };
}

export function createCheckboxLabelStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "flex",
    alignItems: "center",
    gap: theme.spacing.xs,
    fontSize: theme.fontSizes.sm,
    color: theme.colors.foreground,
    cursor: "pointer",
    userSelect: "none",
  };
}

function createSelectionHighlightFrameStyle(
  theme: IDevtoolsTheme,
  selectionHighlightFrame: ISelectionHighlightFrame,
): CSSObject {
  return {
    position: "fixed",
    top: selectionHighlightFrame.top - selectionHighlightVerticalPadding,
    left: selectionHighlightFrame.left - selectionHighlightHorizontalPadding,
    width: selectionHighlightFrame.width + selectionHighlightHorizontalPadding * 2,
    height: selectionHighlightFrame.height + selectionHighlightVerticalPadding * 2,
    boxSizing: "border-box",
    border: `2px solid ${theme.colors.selectionBorder}`,
    borderRadius: theme.radii.sm,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}
