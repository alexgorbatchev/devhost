import type { JSX } from "react";
import { FileCogIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";
import { Button } from "../../../shared";
import { ToolbarSegment } from "../../../shared/components/ToolbarSegment";

interface IConfigEditorButtonProps {
  isOpen: boolean;
  /** Whether devhost rejected the last reload of a configuration file. */
  isRejected: boolean;
  onToggle: () => void;
}

/** Opens and closes the config editor from the toolbar. */
export function ConfigEditorButton({ isOpen, isRejected, onToggle }: IConfigEditorButtonProps): JSX.Element {
  return (
    <ToolbarSegment ariaLabel="Configuration" testId="ConfigEditorButton">
      <Button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        startEnhancer={<Icon glyph={FileCogIcon} />}
        title={isRejected ? "Edit the configuration; devhost rejected its last change" : "Edit the configuration"}
        variant={isRejected ? "danger" : "default"}
        onClick={onToggle}
      >
        Config
      </Button>
    </ToolbarSegment>
  );
}
