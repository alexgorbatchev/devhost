import { type HTMLAttributes, type JSX } from "react";

type SurfaceElement = "article" | "aside" | "div" | "section";
type SurfaceShadow = "none" | "raised" | "soft";
type SurfaceTone = "card" | "subtle";

export interface ISurfaceProps extends HTMLAttributes<HTMLElement> {
  element?: SurfaceElement;
  shadow?: SurfaceShadow;
  tone?: SurfaceTone;
}

const surfaceShadowClassNames: Record<SurfaceShadow, string> = {
  none: "",
  raised: "shadow-[var(--shadow-raised)]",
  soft: "shadow-[var(--shadow-soft)]",
};

const surfaceToneClassNames: Record<SurfaceTone, string> = {
  card: "bg-card",
  subtle: "bg-surface-subtle",
};

export function Surface(props: ISurfaceProps): JSX.Element {
  const { children, className, element = "div", shadow = "soft", tone = "card", ...surfaceProps } = props;
  const Element: SurfaceElement = element;
  const resolvedClassName = [
    "rounded-lg border border-border-subtle",
    surfaceToneClassNames[tone],
    surfaceShadowClassNames[shadow],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Element {...surfaceProps} className={resolvedClassName}>
      {children}
    </Element>
  );
}
