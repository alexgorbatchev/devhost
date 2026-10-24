import {
  Alert,
  AlertDescription,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Separator,
} from "@alexgorbatchev/shadcn";
import type { ReactElement } from "react";
import { useRecovery } from "../hooks/useRecovery";
import type { IRecoveryClient, RecoveryState } from "../types";
import { RecoveryRepository } from "./RecoveryRepository";
import { StatusFrame } from "./StatusFrame";

interface IRecoveryPageProps {
  initial: RecoveryState;
  status: number;
  client: IRecoveryClient;
}

export function RecoveryPage({ initial, status, client }: IRecoveryPageProps): ReactElement {
  const recovery = useRecovery(initial, client);
  const { state } = recovery;
  const isDisabled = recovery.isBusy || !recovery.isConnected;
  return (
    <StatusFrame status={status} title={state.title} message={state.message} context={state.stack}>
      <div className="flex min-w-0 flex-col gap-6">
        <p>
          Service: <strong>{state.service}</strong> · <code>{state.address}</code>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            id="restart"
            type="button"
            disabled={isDisabled || !state.canRestart}
            onClick={() => void recovery.restart()}
          >
            Restart {state.service}
          </Button>
          {recovery.isBusy && <p role="status">Working…</p>}
        </div>
        {recovery.error && (
          <Alert variant="destructive" id="error">
            <AlertDescription>
              <p className="whitespace-pre-wrap">{recovery.error}</p>
            </AlertDescription>
          </Alert>
        )}
        {state.repositories.length > 0 && (
          <section id="worktrees" aria-labelledby="worktrees-title" className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="worktrees-title">Worktrees</h2>
              <Button
                id="refresh-worktrees"
                type="button"
                variant="outline"
                disabled={isDisabled}
                onClick={() => void recovery.refresh()}
              >
                Refresh worktrees
              </Button>
            </div>
            {state.repositories.map((repository) => (
              <RecoveryRepository
                key={repository.id}
                repository={repository}
                isDisabled={isDisabled || !recovery.hasWorktrees}
                onSelect={recovery.select}
              />
            ))}
          </section>
        )}
        <Separator />
        <Collapsible defaultOpen>
          <CollapsibleTrigger id="logs-toggle" render={<Button variant="ghost" />}>
            Recent logs
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre id="logs" className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap wrap-anywhere">
              {state.logs.join("\n")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </StatusFrame>
  );
}
