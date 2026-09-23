import type { JSX, ReactNode } from "react";
import { TriangleAlertIcon, XIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../../components/ui/Alert";

type InlineNoticeTone = "default" | "danger";

interface IInlineNoticeProps {
  action?: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
  testId?: string;
  title?: ReactNode;
  tone?: InlineNoticeTone;
}

export function InlineNotice({
  action,
  children,
  onDismiss,
  testId,
  title,
  tone = "default",
}: IInlineNoticeProps): JSX.Element {
  return (
    <Alert data-testid={testId} variant={tone === "danger" ? "destructive" : "default"}>
      {tone === "danger" ? <TriangleAlertIcon aria-hidden="true" /> : null}
      {title !== undefined ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
      {action !== undefined || onDismiss !== undefined ? (
        <AlertAction>
          {action}
          {onDismiss !== undefined ? (
            // Inherits the notice color so the control stays legible on the solid danger strip.
            <button
              aria-label="Dismiss"
              className="grid size-5 place-items-center rounded-sm text-current hover:bg-black/15 [&_svg]:size-3.5"
              data-testid="InlineNotice--dismiss"
              type="button"
              onClick={onDismiss}
            >
              <XIcon aria-hidden="true" />
            </button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
