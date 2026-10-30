import type { JSX } from "react";

import { Button, InlineNotice } from "../../../shared";
import { HOT_RELOAD_CLIENT_LABELS } from "../constants";
import type { HotReloadClient } from "../types";

interface IHotReloadNoticeProps {
  client: HotReloadClient;
  onDisable: () => void;
  onDismiss: () => void;
}

/** Offers to have the agent turn off the hot reloading that refreshes this page while agents edit files. */
export function HotReloadNotice({ client, onDisable, onDismiss }: IHotReloadNoticeProps): JSX.Element {
  return (
    <InlineNotice
      action={<Button onClick={onDisable}>Disable Reloads</Button>}
      testId="HotReloadNotice"
      title={`${HOT_RELOAD_CLIENT_LABELS[client]} hot reloading is on`}
      onDismiss={onDismiss}
    >
      Agent edits can refresh this page while you use it.
    </InlineNotice>
  );
}
