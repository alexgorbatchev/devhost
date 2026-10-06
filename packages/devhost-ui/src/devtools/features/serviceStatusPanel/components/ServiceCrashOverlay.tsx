import Anser from "anser";
import { RotateCwIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX } from "react";

import { cn } from "../../../../lib/utils";
import { Button, InlineNotice } from "../../../shared";
import { pristineFetch } from "../../../shared/pristineFetch";
import { restartServices } from "../../../shared/restartServices";
import type { ServiceHealth, ServiceLogEntry } from "../../../shared/types";

interface IServiceCrashOverlayProps {
  services: ServiceHealth[];
  entries: ServiceLogEntry[];
}

export function ServiceCrashOverlay({ services, entries }: IServiceCrashOverlayProps): JSX.Element {
  const dialogReference = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const [pendingServices, setPendingServices] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogReference.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const handleRestart = async (serviceName: string): Promise<void> => {
    setPendingServices((current) => [...current, serviceName]);
    setErrorMessage(null);
    const error = await restartServices([serviceName], pristineFetch);
    setErrorMessage(error);
    setPendingServices((current) => current.filter((name) => name !== serviceName));
    if (error === null && document.body.hasAttribute("data-devhost-recovery")) {
      window.location.reload();
    }
  };

  return (
    <dialog
      ref={dialogReference}
      aria-labelledby={titleId}
      className="pointer-events-auto fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none flex-col gap-3 overflow-auto border-0 bg-background p-4 font-mono text-lg text-foreground"
      data-testid="ServiceCrashOverlay"
      onCancel={(event) => event.preventDefault()}
    >
      <header className="flex flex-col gap-1">
        <h1 id={titleId} className="m-0 font-semibold text-destructive">
          Service exited
        </h1>
        <p className="m-0 text-muted-foreground">devhost is running. Review the service logs and restart when ready.</p>
      </header>
      {errorMessage !== null ? <InlineNotice tone="danger">{errorMessage}</InlineNotice> : null}
      {services.map((service) => {
        const isRestarting = service.restarting === true || pendingServices.includes(service.name);
        const serviceEntries = entries.filter((entry) => entry.serviceName === service.name);
        return (
          <section
            key={service.name}
            aria-label={`${service.name} recovery`}
            className="flex min-h-40 flex-1 flex-col gap-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 font-semibold">
                {service.name} <span className="text-muted-foreground">(exit code {service.exitCode})</span>
              </h2>
              <Button
                disabled={isRestarting}
                startEnhancer={<RotateCwIcon />}
                variant="primary"
                onClick={() => {
                  void handleRestart(service.name);
                }}
              >
                {isRestarting ? `Restarting ${service.name}…` : `Restart ${service.name}`}
              </Button>
            </div>
            <div
              aria-label={`${service.name} logs`}
              role="region"
              tabIndex={0}
              className="min-h-0 flex-1 overflow-auto rounded-sm border bg-card p-2"
            >
              {serviceEntries.length === 0 ? (
                <p className="m-0 text-muted-foreground">No retained logs for this service.</p>
              ) : (
                <ol className="m-0 list-none p-0">
                  {serviceEntries.map((entry) => (
                    <li
                      key={entry.id}
                      className={cn("whitespace-pre-wrap break-words", entry.stream === "stderr" && "text-destructive")}
                    >
                      <span className="sr-only">{entry.stream}: </span>
                      {Anser.ansiToText(entry.line)}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        );
      })}
    </dialog>
  );
}
