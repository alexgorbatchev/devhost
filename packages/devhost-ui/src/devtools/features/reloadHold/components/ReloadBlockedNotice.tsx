import type { JSX } from "react";
import { Button, InlineNotice } from "../../../shared";
import { reloadPage } from "../../../shared/reloadPage";

interface IReloadBlockedNoticeProps {
  onDismiss: VoidFunction;
}

/** Says a reload was held, usually a dev server's, and gives it back in one click. */
export function ReloadBlockedNotice({ onDismiss }: IReloadBlockedNoticeProps): JSX.Element {
  return (
    <InlineNotice
      action={<Button onClick={reloadPage}>Reload</Button>}
      testId="ReloadBlockedNotice"
      title="Reload blocked"
      onDismiss={onDismiss}
    >
      Something tried to reload this page.
    </InlineNotice>
  );
}
