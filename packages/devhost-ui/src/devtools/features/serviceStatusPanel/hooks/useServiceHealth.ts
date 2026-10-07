import { useCallback, useEffect, useState } from "react";

import { HEALTH_WEBSOCKET_PATH, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../../../shared/constants";
import { createDevtoolsWebSocketUrl } from "../../../shared/createDevtoolsWebSocketUrl";
import { pristineFetch, pristineWebSocket } from "../../../shared/pristineFetch";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import type { HealthResponse, ServiceHealth, IWorktreeRepository } from "../../../shared/types";
import { parseHealthResponse } from "../parseHealthResponse";
import { requestWorktrees } from "../requestWorktrees";
import { markServicesAsUnavailable } from "../markServicesAsUnavailable";
import { updateInjectedRouting } from "../updateInjectedRouting";

const normalClosureCode: number = 1_000;

interface IUseServiceHealthResult {
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  services: ServiceHealth[];
  repositories: IWorktreeRepository[];
  refreshWorktrees: () => Promise<string | null>;
  switchWorktree: (repositoryId: string, path: string) => Promise<string | null>;
}

export function useServiceHealth(): IUseServiceHealthResult {
  const [repositories, setRepositories] = useState<IWorktreeRepository[]>([]);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { stackName: devtoolsStackName } = readInjectedDevtoolsConfig();

  const updateHealth = useCallback((health: HealthResponse): void => {
    updateInjectedRouting(health.routing, Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME));
    setServices(health.services);
    setRepositories(health.repositories ?? []);
  }, []);

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

      updateHealth(healthResponse);
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
      setRepositories([]);
      setErrorMessage(null);
    };

    websocket = pristineWebSocket(createDevtoolsWebSocketUrl(HEALTH_WEBSOCKET_PATH, window.location));
    websocket.addEventListener("open", handleOpen);
    websocket.addEventListener("message", handleMessage);
    websocket.addEventListener("close", handleClose);

    return () => {
      isDisposed = true;
      websocket?.close(normalClosureCode, "devtools unmounted");
    };
  }, [devtoolsStackName, updateHealth]);

  const refreshWorktrees = useCallback(async (): Promise<string | null> => {
    const result = await requestWorktrees(pristineFetch);
    if (result.health !== null) {
      updateHealth(result.health);
    }
    return result.error;
  }, [updateHealth]);
  const switchWorktree = useCallback(
    async (repositoryId: string, path: string): Promise<string | null> => {
      const result = await requestWorktrees(pristineFetch, { repositoryId, path });
      await refreshWorktrees();
      return result.error;
    },
    [refreshWorktrees],
  );
  return {
    repositories,
    refreshWorktrees,
    switchWorktree,
    errorMessage,
    setErrorMessage,
    services,
  };
}
