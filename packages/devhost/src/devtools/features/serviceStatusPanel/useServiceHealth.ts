import { useEffect, useState } from "preact/hooks";

import { HEALTH_WEBSOCKET_PATH } from "../../shared/constants";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import { readDevtoolsStackName } from "../../shared/readDevtoolsStackName";
import type { HealthResponse, ServiceHealth } from "../../shared/types";
import { markServicesAsUnavailable } from "./markServicesAsUnavailable";

const normalClosureCode: number = 1_000;

interface IUseServiceHealthResult {
  errorMessage: string | null;
  services: ServiceHealth[];
}

export function useServiceHealth(): IUseServiceHealthResult {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const devtoolsStackName: string = readDevtoolsStackName();

  useEffect(() => {
    let websocket: WebSocket | null = null;
    let isDisposed: boolean = false;

    const handleOpen = (): void => {
      setErrorMessage(null);
    };

    const handleMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") {
        setErrorMessage("devhost status stream sent a non-text message.");
        return;
      }

      const healthResponse: HealthResponse | null = parseHealthResponse(event.data);

      if (healthResponse === null) {
        setErrorMessage("devhost status stream sent malformed data.");
        return;
      }

      setServices(healthResponse.services);
      setErrorMessage(null);
    };

    const handleClose = (event: CloseEvent): void => {
      websocket = null;

      if (isDisposed || event.code === normalClosureCode) {
        return;
      }

      setServices((currentServices: ServiceHealth[]): ServiceHealth[] => {
        return markServicesAsUnavailable(currentServices, devtoolsStackName);
      });
      setErrorMessage(null);
    };

    websocket = new WebSocket(createDevtoolsWebSocketUrl(HEALTH_WEBSOCKET_PATH, window.location));
    websocket.addEventListener("open", handleOpen);
    websocket.addEventListener("message", handleMessage);
    websocket.addEventListener("close", handleClose);

    return () => {
      isDisposed = true;
      websocket?.close(normalClosureCode, "devtools unmounted");
    };
  }, [devtoolsStackName]);

  return {
    errorMessage,
    services,
  };
}

function parseHealthResponse(message: string): HealthResponse | null {
  try {
    const value: unknown = JSON.parse(message);

    return isHealthResponse(value) ? value : null;
  } catch {
    return null;
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const services: unknown = Reflect.get(value, "services");

  if (!Array.isArray(services)) {
    return false;
  }

  return services.every((service: unknown): boolean => {
    if (typeof service !== "object" || service === null) {
      return false;
    }

    const url: unknown = Reflect.get(service, "url");

    return (
      typeof Reflect.get(service, "name") === "string" &&
      typeof Reflect.get(service, "status") === "boolean" &&
      (typeof url === "string" || url === undefined)
    );
  });
}
