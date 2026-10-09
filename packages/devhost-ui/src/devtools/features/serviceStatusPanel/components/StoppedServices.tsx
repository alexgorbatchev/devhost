import { useState, type JSX } from "react";
import { PlayIcon, RotateCwIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";

import { Button, InlineNotice } from "../../../shared";
import type { IStoppedService } from "../../../shared/types";

interface IStoppedServicesProps {
  services: IStoppedService[];
  isBlocked: boolean;
  onStart: (serviceNames: string[]) => Promise<string | null>;
}

/** The services this run has not started, each with the action that starts it. */
export function StoppedServices({ services, isBlocked, onStart }: IStoppedServicesProps): JSX.Element {
  const [startingName, setStartingName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const start = async (name: string): Promise<void> => {
    setStartingName(name);
    setErrorMessage(null);
    const message = await onStart([name]);
    setStartingName(null);
    setErrorMessage(message);
  };

  return (
    <div data-testid="StoppedServices">
      {errorMessage !== null ? <InlineNotice tone="danger">{errorMessage}</InlineNotice> : null}
      <p className="m-0 border-b px-2 py-1 text-muted-foreground">
        Starting a service also starts the services it depends on. Running services keep running.
      </p>
      <ul className="m-0 list-none p-0">
        {services.map((service) => {
          const isStarting = startingName === service.name;

          return (
            <li
              key={service.name}
              className="flex min-h-6 items-center gap-1.5 py-0.5 pr-1 pl-2 not-first:border-t hover:bg-secondary"
              data-testid="StoppedServices--service"
            >
              <span className="min-w-0 flex-1 truncate">{service.name}</span>
              <Button
                aria-label={`Start ${service.name}`}
                disabled={isBlocked || startingName !== null}
                startEnhancer={<Icon glyph={isStarting ? RotateCwIcon : PlayIcon} isSpinning={isStarting} />}
                onClick={(): void => {
                  void start(service.name);
                }}
              >
                {isStarting ? "Starting…" : "Start"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
