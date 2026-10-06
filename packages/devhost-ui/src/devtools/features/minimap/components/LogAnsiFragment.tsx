import type { JSX } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../../../lib/utils";
import { useDevtoolsColorScheme } from "../../../shared";
import type { ILogAnsiFragment } from "../parseAnsiLogLine";
import { readLogAnsiForeground } from "../readLogAnsiForeground";

interface ILogAnsiFragmentProps {
  fragment: ILogAnsiFragment;
  isFocusedRow: boolean;
}

export function LogAnsiFragment({ fragment, isFocusedRow }: ILogAnsiFragmentProps): JSX.Element {
  const colorScheme = useDevtoolsColorScheme();
  const elementReference = useRef<HTMLSpanElement | null>(null);
  const [foreground, setForeground] = useState<string>();

  // Measure actual CSS after the row/theme has committed and update before paint, avoiding an unreadable frame.
  useLayoutEffect(() => {
    if (elementReference.current !== null) {
      setForeground(readLogAnsiForeground(elementReference.current, fragment));
    }
  }, [colorScheme, fragment, isFocusedRow]);

  return (
    <span
      ref={elementReference}
      data-testid="LogAnsiFragment"
      className={cn(
        fragment.isBold && "font-semibold",
        fragment.isItalic && "italic",
        fragment.isStrikethrough && !fragment.isUnderline && "line-through",
        fragment.isUnderline && !fragment.isStrikethrough && "underline",
        fragment.isUnderline && fragment.isStrikethrough && "[text-decoration-line:underline_line-through]",
      )}
      // ANSI colors are dynamic service data, rather than static theme styling.
      style={{ backgroundColor: fragment.backgroundColor ?? undefined, color: foreground }}
    >
      {fragment.text}
    </span>
  );
}
