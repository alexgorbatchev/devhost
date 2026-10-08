import { useEffect, useState } from "react";

import { RESOURCES_WEBSOCKET_PATH } from "../../../shared/constants";
import { createDevtoolsWebSocketUrl } from "../../../shared/createDevtoolsWebSocketUrl";
import { openReconnectingWebSocket } from "../../../shared/openReconnectingWebSocket";
import { parseResourceUsageMessage } from "../parseResourceUsageMessage";
import type { IResourceUsage } from "../types";

/**
 * The host's latest CPU, memory, and disk readings, or `null` while there are none to show: resources are off,
 * nothing has arrived yet, or the stream is down.
 */
export function useResourceUsage(isEnabled: boolean): IResourceUsage | null {
  const [usage, setUsage] = useState<IResourceUsage | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const stream = openReconnectingWebSocket(createDevtoolsWebSocketUrl(RESOURCES_WEBSOCKET_PATH, window.location), {
      // A reading that has stopped updating would pass for the machine's current state.
      onDisconnect: (): void => {
        setUsage(null);
      },
      onMessage: (event: MessageEvent): void => {
        const nextUsage: IResourceUsage | null = parseResourceUsageMessage(event.data);

        if (nextUsage !== null) {
          setUsage(nextUsage);
        }
      },
    });

    return (): void => {
      stream.close();
      setUsage(null);
    };
  }, [isEnabled]);

  return usage;
}
