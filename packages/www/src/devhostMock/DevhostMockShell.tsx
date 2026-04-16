import { useEffect, useRef, type JSX, type ReactNode } from "react";

import type { MarketingRecordingScenarioId } from "../features/marketingRecording/marketingRecordingScenarios";
import { installDevhostMockEnvironment } from "./installDevhostMockEnvironment";

interface IDevhostMockShellProps {
  children: ReactNode;
  onReady?: () => void;
  scenarioId: MarketingRecordingScenarioId;
}

const captureDevtoolsScriptPath: string = "/__capture__/devtools.js";
const captureResetPathname: string = "/__capture__/reset";

export function DevhostMockShell({ children, onReady, scenarioId }: IDevhostMockShellProps): JSX.Element {
  const onReadyReference = useRef<IDevhostMockShellProps["onReady"]>(onReady);

  onReadyReference.current = onReady;

  useEffect(() => {
    const teardownMockEnvironment = installDevhostMockEnvironment(scenarioId);
    const scriptElement: HTMLScriptElement = document.createElement("script");
    let isDisposed: boolean = false;

    scriptElement.src = captureDevtoolsScriptPath;
    scriptElement.type = "module";
    scriptElement.setAttribute("data-devhost-capture-script", "");
    scriptElement.addEventListener("load", () => {
      if (isDisposed) {
        return;
      }

      window.requestAnimationFrame((): void => {
        if (!isDisposed) {
          onReadyReference.current?.();
        }
      });
    });
    scriptElement.addEventListener("error", () => {
      console.error("Failed to load the mocked devhost devtools capture script.");
    });

    void fetch(`${captureResetPathname}?scenario=${encodeURIComponent(scenarioId)}`, {
      method: "POST",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Capture reset failed with status ${response.status}.`);
        }

        if (!isDisposed) {
          document.head.append(scriptElement);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to reset the mocked devtools capture state:", error);
      });

    return (): void => {
      isDisposed = true;
      teardownMockEnvironment();

      scriptElement.remove();

      const hostElement: HTMLElement | null = document.getElementById("devhost-devtools-host");

      if (hostElement !== null) {
        hostElement.remove();
      }
    };
  }, [scenarioId]);

  return <div data-testid="DevhostMockShell">{children}</div>;
}
