import { useEffect, useState } from "preact/hooks";

import { markServicesAsUnavailable } from "../markServicesAsUnavailable";
import { HEALTH_WEBSOCKET_PATH } from "./constants";
import { createDevtoolsWebSocketUrl } from "./createDevtoolsWebSocketUrl";
import { readDevtoolsStackName } from "./readDevtoolsStackName";
import type { HealthResponse, ServiceHealth } from "./types";

const normalClosureCode: number = 1_000;

interface IUseServiceHealthResult {
  errorMessage: string | null;
  isConnected: boolean;
  services: ServiceHealth[];
}

export function useServiceHealth(): IUseServiceHealthResult {
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const devtoolsStackName: string = readDevtoolsStackName();

  useEffect(() => {
    let websocket: WebSocket | null = null;
    let isDisposed: boolean = false;

    const handleOpen = (): void => {
      setIsConnected(true);
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

    const handleError = (): void => {
      setIsConnected(false);
    };

    const handleClose = (event: CloseEvent): void => {
      websocket = null;
      setIsConnected(false);

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
    websocket.addEventListener("error", handleError);
    websocket.addEventListener("close", handleClose);

    return () => {
      isDisposed = true;
      websocket?.close(normalClosureCode, "devtools unmounted");
    };
  }, [devtoolsStackName]);

  return {
    errorMessage,
    isConnected,
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
    return (
      typeof service === "object" &&
      service !== null &&
      typeof Reflect.get(service, "name") === "string" &&
      typeof Reflect.get(service, "status") === "boolean"
    );
  });
}

