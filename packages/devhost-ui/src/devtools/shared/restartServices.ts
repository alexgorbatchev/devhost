import { DEVTOOLS_CONTROL_TOKEN_HEADER_NAME, RESTART_SERVICE_PATH } from "./constants";

export async function restartServices(
  serviceNames: string[],
  controlToken: string,
  request: typeof fetch,
): Promise<string | null> {
  try {
    const response = await request(RESTART_SERVICE_PATH, {
      body: JSON.stringify({ serviceNames }),
      headers: {
        [DEVTOOLS_CONTROL_TOKEN_HEADER_NAME]: controlToken,
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (response.ok) {
      return null;
    }

    const bodyText = await response.text();
    let detail = bodyText.trim();
    try {
      const payload: unknown = JSON.parse(bodyText);
      if (typeof payload === "object" && payload !== null) {
        const message: unknown = Reflect.get(payload, "error") ?? Reflect.get(payload, "message");
        if (typeof message === "string") {
          detail = message;
        }
      }
    } catch {
      // The supervisor also returns plain-text HTTP errors.
    }
    return `Failed to restart ${serviceNames.join(", ")}: ${detail || response.statusText}`;
  } catch (error: unknown) {
    return `Failed to restart ${serviceNames.join(", ")}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
