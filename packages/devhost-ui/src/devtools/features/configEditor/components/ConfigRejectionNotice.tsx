import type { JSX } from "react";

import { Button, InlineNotice } from "../../../shared";
import type { ConfigurationSource, IConfigurationStatus } from "../../../shared/types";

interface IConfigRejectionNoticeProps {
  configuration: IConfigurationStatus[];
  /** Opens the config editor; absent while the editor is off. */
  onEdit?: () => void;
}

const sourceTitles: Record<ConfigurationSource, string> = {
  config: "devhost config change not applied",
  manifest: "Manifest change not applied",
};

/** Says why devhost rejected the last reload of each configuration source; the stack runs what it accepted before. */
export function ConfigRejectionNotice({ configuration, onEdit }: IConfigRejectionNoticeProps): JSX.Element | null {
  const rejected: IConfigurationStatus[] = configuration.filter(
    (status: IConfigurationStatus): boolean => status.error !== undefined,
  );

  if (rejected.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1" data-testid="ConfigRejectionNotice">
      {rejected.map((status: IConfigurationStatus) => (
        <InlineNotice
          key={status.source}
          action={onEdit === undefined ? undefined : <Button onClick={onEdit}>Edit</Button>}
          testId="ConfigRejectionNotice--source"
          title={sourceTitles[status.source]}
          tone="danger"
        >
          <span className="whitespace-pre-wrap">{status.error}</span>
        </InlineNotice>
      ))}
    </div>
  );
}
