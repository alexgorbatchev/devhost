import type { JSX, ReactNode } from "react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../../components/ui/alert";

type InlineNoticeTone = "default" | "danger";

interface IInlineNoticeProps {
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
  title?: ReactNode;
  tone?: InlineNoticeTone;
}

export function InlineNotice({ action, children, testId, title, tone = "default" }: IInlineNoticeProps): JSX.Element {
  return (
    <Alert data-testid={testId} variant={tone === "danger" ? "destructive" : "default"}>
      {title !== undefined ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
      {action !== undefined ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}
