import { useCallback, useEffect, useState } from "react";

import { HEALTH_WEBSOCKET_PATH, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../../../shared/constants";
import { createDevtoolsWebSocketUrl } from "../../../shared/createDevtoolsWebSocketUrl";
import { openReconnectingWebSocket } from "../../../shared/openReconnectingWebSocket";
import { pristineFetch } from "../../../shared/pristineFetch";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import type {
  HealthResponse,
  IConfigurationStatus,
  ServiceHealth,
  IStoppedService,
  IWorktreeRepository,
} from "../../../shared/types";
import { parseHealthResponse } from "../parseHealthResponse";
import { requestWorktrees } from "../requestWorktrees";
import { startServices } from "../startServices";
import { markServicesAsUnavailable } from "../markServicesAsUnavailable";
import { updateInjectedConfig } from "../updateInjectedConfig";

interface IUseServiceHealthResult {
  /** The reloads of each configuration source, with the reason the last one was rejected. */
  configuration: IConfigurationStatus[];
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  services: ServiceHealth[];
  stoppedServices: IStoppedService[];
  repositories: IWorktreeRepository[];
  refreshWorktrees: () => Promise<string | null>;
  switchWorktree: (repositoryId: string, path: string) => Promise<string | null>;
  startStoppedServices: (serviceNames: string[]) => Promise<string | null>;
}

export function useServiceHealth(): IUseServiceHealthResult {
  const [repositories, setRepositories] = useState<IWorktreeRepository[]>([]);
  const [services, setServices] = useState<ServiceHealth[]>([]);
  const [stoppedServices, setStoppedServices] = useState<IStoppedService[]>([]);
  const [configuration, setConfiguration] = useState<IConfigurationStatus[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { stackName: devtoolsStackName } = readInjectedDevtoolsConfig();

  const updateHealth = useCallback((health: HealthResponse): void => {
    Reflect.set(
      globalThis,
      DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME,
      updateInjectedConfig(health.config, Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME)),
    );
    setServices(health.services);
    setStoppedServices(health.stoppedServices ?? []);
    setRepositories(health.repositories ?? []);
    setConfiguration(health.configuration ?? []);
  }, []);

  useEffect(() => {
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

    // Until the stream is back, nothing is known about the stack.
    const handleDisconnect = (): void => {
      setServices((currentServices: ServiceHealth[]): ServiceHealth[] => {
        return markServicesAsUnavailable(currentServices, devtoolsStackName);
      });
      setStoppedServices([]);
      setRepositories([]);
      setConfiguration([]);
      setErrorMessage(null);
    };

    const stream = openReconnectingWebSocket(createDevtoolsWebSocketUrl(HEALTH_WEBSOCKET_PATH, window.location), {
      onDisconnect: handleDisconnect,
      onMessage: handleMessage,
      onOpen: (): void => {
        setErrorMessage(null);
      },
    });

    return stream.close;
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
      if (result.error === null) window.location.reload();
      else await refreshWorktrees();
      return result.error;
    },
    [refreshWorktrees],
  );
  // The health stream reports the started services; nothing is read from the response.
  const startStoppedServices = useCallback((serviceNames: string[]): Promise<string | null> => {
    return startServices(serviceNames, pristineFetch);
  }, []);
  return {
    configuration,
    repositories,
    refreshWorktrees,
    switchWorktree,
    startStoppedServices,
    errorMessage,
    setErrorMessage,
    services,
    stoppedServices,
  };
}
