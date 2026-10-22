import { useRef, useState, type JSX } from "react";
import { PageChat } from "../../../src/devtools/features/agentChat/components/PageChat";
import { DevtoolsTopLayer } from "../../../src/devtools/shared/components/DevtoolsTopLayer";
import { DevtoolsToolbar } from "../../../src/devtools/shared/components/DevtoolsToolbar";
import type { ChatTarget } from "../../../src/devtools/shared/types";

interface ITabCaptureSceneProps {
  /** `devhost` annotates devhost's own UI; `project` annotates the page under it. */
  target: ChatTarget;
}

export function TabCaptureScene({ target }: ITabCaptureSceneProps): JSX.Element {
  const rootReference = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  return (
    <div data-testid="TabCaptureScene">
      <DevtoolsTopLayer ref={rootReference}>
        <PageChat
          target={target}
          isOpen={isOpen}
          onOpenChange={setIsOpen}
          isSelectionEnabled
          rootReference={rootReference}
        />
        <DevtoolsToolbar
          collapsedIndicator={null}
          isMinimapVisible={false}
          position="bottom-right"
          stackName="native-capture"
        >
          <span>Native capture dock</span>
        </DevtoolsToolbar>
      </DevtoolsTopLayer>
    </div>
  );
}
