import type { LucideIcon } from "lucide-react";
import type { JSX } from "react";

type IconSize = "md" | "sm";
type IconTone = "current" | "destructive" | "success";

interface IIconProps {
  glyph: LucideIcon;
  isSpinning?: boolean;
  size?: IconSize;
  tone?: IconTone;
}

const iconPixelSizes: Record<IconSize, number> = {
  md: 14,
  sm: 12,
};

/**
 * A decorative icon at one of the devtools icon sizes. Lucide components are styled through their own props, so the
 * glyph carries data attributes and the `[data-slot="icon"]` rules in devtools.css supply the rest: it never
 * shrinks, never becomes the pointer target inside a control, and can take a tone or spin.
 */
export function Icon({ glyph: Glyph, isSpinning = false, size = "md", tone = "current" }: IIconProps): JSX.Element {
  return (
    <Glyph
      aria-hidden="true"
      data-slot="icon"
      data-spinning={isSpinning}
      data-testid="Icon"
      data-tone={tone}
      size={iconPixelSizes[size]}
    />
  );
}
