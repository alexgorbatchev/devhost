import { createConnection } from "node:net";

import { pollIntervalInMilliseconds } from "./constants";

export async function canConnectToPort(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const socket = createConnection({
      host,
      port,
    });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.setTimeout(pollIntervalInMilliseconds, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function isReadyHttpEndpoint(url: string): Promise<boolean> {
  try {
    const response: Response = await fetch(url, {
      redirect: "manual",
    });

    return response.ok;
  } catch {
    return false;
  }
}
