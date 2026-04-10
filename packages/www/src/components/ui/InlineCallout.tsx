import type { ReactNode, JSX } from "react";

export interface IInlineCalloutProps {
  children: ReactNode;
  /**
   * Optional blockquote left border treatment
   */
  hasBorder?: boolean;
}

export function InlineCallout({ children, hasBorder }: IInlineCalloutProps): JSX.Element {
  return (
    <span
      className={["bg-secondary px-1.5 py-0.5", hasBorder ? "border-l-4 border-border pl-2" : ""]
        .filter(Boolean)
        .join(" ")}
      data-testid="InlineCallout"
    >
      {children}
    </span>
  );
}
