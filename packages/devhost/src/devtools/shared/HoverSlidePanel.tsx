import type { CSSObject } from "@emotion/css/create-instance";
import type { ReactNode, JSX } from "react";
import { useState } from "react";

import { css } from "./devtoolsCss";
import type { IDevtoolsTheme } from "./devtoolsTheme";
import type { PanelSide } from "./panelSide";
import { resolveHoverSlidePanelTransform } from "./resolveHoverSlidePanelTransform";
import { useDevtoolsTheme } from "./useDevtoolsTheme";

interface IHoverSlidePanelProps {
  ariaLabel: string;
  children: ReactNode;
  isPinned?: boolean;
  panelSide: PanelSide;
  peekWidth: string;
  style?: CSSObject;
  testId?: string;
}

const hoverSlidePanelTransition: string = "transform 160ms ease";

export function HoverSlidePanel({
  ariaLabel,
  children,
  isPinned = false,
  panelSide,
  peekWidth,
  style,
  testId,
}: IHoverSlidePanelProps): JSX.Element {
  const theme = useDevtoolsTheme();
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const panelClassName: string = css(createPanelStyle(theme, panelSide, isHovered || isPinned, peekWidth, style));

  return (
    <section
      aria-label={ariaLabel}
      className={panelClassName}
      data-testid={testId !== undefined ? testId : "HoverSlidePanel"}
      onMouseEnter={(): void => {
        setIsHovered(true);
      }}
      onMouseLeave={(): void => {
        setIsHovered(false);
      }}
    >
      {children}
    </section>
  );
}

function createPanelStyle(
  theme: IDevtoolsTheme,
  panelSide: PanelSide,
  isHovered: boolean,
  peekWidth: string,
  style: CSSObject | undefined,
): CSSObject {
  return {
    background: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    boxShadow: theme.shadows.floating,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    overflow: "visible",
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    position: "relative",
    transform: resolveHoverSlidePanelTransform(panelSide, isHovered, peekWidth),
    transition: hoverSlidePanelTransition,
    willChange: "transform",
    zIndex: Number(theme.zIndices.floating) + 2,
    "&::after": {
      content: '""',
      position: "absolute",
      top: 0,
      bottom: 0,
      [panelSide === "left" ? "left" : "right"]: "-50px",
      width: "50px",
    },
    ...style,
  };
}
