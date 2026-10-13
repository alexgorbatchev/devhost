import { useState, type JSX } from "react";

import { Button } from "../../../components/ui/Button";
import { pristineFetch } from "../pristineFetch";
import { restartStack } from "../restartStack";
import { InlineNotice } from "./InlineNotice";

interface IRestartStackButtonProps {
  isDisabled: boolean;
  onPendingChange: (isPending: boolean) => void;
  onRestartChanged?: () => Promise<string | null>;
  restartChangedShortcut?: string;
  isRestartChangedDisabled?: boolean;
}

export function RestartStackButton({
  isDisabled,
  onPendingChange,
  onRestartChanged,
  restartChangedShortcut,
  isRestartChangedDisabled = false,
}: IRestartStackButtonProps): JSX.Element {
  const [isPending, setIsPending] = useState<boolean>(false);
  const [isChangedPending, setIsChangedPending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorTitle, setErrorTitle] = useState<string>("Stack restart failed");
  const handleRestart = async (): Promise<void> => {
    setIsPending(true);
    onPendingChange(true);
    setErrorMessage(null);
    setErrorTitle("Stack restart failed");
    const error = await restartStack(pristineFetch);
    setErrorMessage(error);
    setIsPending(false);
    onPendingChange(false);
    if (error === null && document.body.hasAttribute("data-devhost-recovery")) window.location.reload();
  };
  const handleRestartChanged = async (): Promise<void> => {
    if (onRestartChanged === undefined) return;
    setIsChangedPending(true);
    onPendingChange(true);
    setErrorMessage(null);
    setErrorTitle("Service restart failed");
    const error = await onRestartChanged();
    setErrorMessage(error);
    setIsChangedPending(false);
    onPendingChange(false);
  };

  return (
    <section aria-label="Stack recovery" className="flex flex-col gap-1.5 p-2" data-testid="RestartStackButton">
      <div className="flex items-center justify-end gap-1.5">
        {onRestartChanged !== undefined ? (
          <Button
            disabled={isDisabled || isPending || isChangedPending || isRestartChangedDisabled}
            title="Restart changed services, or the primary service when none changed"
            shortcut={restartChangedShortcut}
            onClick={() => {
              void handleRestartChanged();
            }}
          >
            {isChangedPending ? "Restarting…" : "Restart Changed"}
          </Button>
        ) : null}
        <Button
          title="Restarts all managed services and reassigns automatic ports."
          disabled={isDisabled || isPending || isChangedPending}
          onClick={() => {
            void handleRestart();
          }}
        >
          {isPending ? "Restarting stack…" : "Restart Stack"}
        </Button>
      </div>
      {errorMessage !== null ? (
        <div role="group" aria-label={errorTitle}>
          <InlineNotice title={errorTitle} tone="danger">
            {errorMessage}
          </InlineNotice>
        </div>
      ) : null}
    </section>
  );
}
