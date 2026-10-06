import { RotateCwIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { Button } from "../../../components/ui/Button";
import { pristineFetch } from "../pristineFetch";
import { restartStack } from "../restartStack";
import { InlineNotice } from "./InlineNotice";

interface IRestartStackButtonProps {
  isDisabled: boolean;
  onPendingChange: (isPending: boolean) => void;
}

export function RestartStackButton({ isDisabled, onPendingChange }: IRestartStackButtonProps): JSX.Element {
  const [isPending, setIsPending] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const handleRestart = async (): Promise<void> => {
    setIsPending(true);
    onPendingChange(true);
    setErrorMessage(null);
    const error = await restartStack(pristineFetch);
    setErrorMessage(error);
    setIsPending(false);
    onPendingChange(false);
    if (error === null && document.body.hasAttribute("data-devhost-recovery")) window.location.reload();
  };

  return (
    <section
      aria-label="Stack recovery"
      className="flex flex-col items-start gap-1 p-2"
      data-testid="RestartStackButton"
    >
      <Button
        disabled={isDisabled || isPending}
        startEnhancer={<RotateCwIcon />}
        onClick={() => {
          void handleRestart();
        }}
      >
        {isPending ? "Restarting stack…" : "Restart stack with new ports"}
      </Button>
      <p className="m-0 text-muted-foreground">Restarts all managed services and reassigns automatic ports.</p>
      {errorMessage !== null ? (
        <div role="group" aria-label="Stack restart failed">
          <InlineNotice title="Stack restart failed" tone="danger">
            {errorMessage}
          </InlineNotice>
        </div>
      ) : null}
    </section>
  );
}
