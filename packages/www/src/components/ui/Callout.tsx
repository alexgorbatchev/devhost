import type { ReactNode, JSX } from "react";

export interface ICalloutProps {
  children: ReactNode;
  /**
   * Optional title for the callout.
   */
  title?: string;
}

export function Callout({ children, title }: ICalloutProps): JSX.Element {
  return (
    <div className="callout bg-secondary border-l-4 border-border p-4 my-6" data-testid="Callout">
      {title && <div className="font-semibold mb-2 text-foreground">{title}</div>}
      <div className="text-sm prose-p:!mt-0 prose-p:!mb-0 [&>p:not(:last-child)]:mb-4">{children}</div>
    </div>
  );
}
