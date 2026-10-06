import type { FetchFunction } from "./pristineFetch";

interface IControlAction {
  path: string;
  failureLabel: string;
  body?: string;
}

export async function postControlAction(action: IControlAction, request: FetchFunction): Promise<string | null> {
  try {
    const options: RequestInit = { method: "POST" };
    if (action.body !== undefined) {
      options.body = action.body;
      options.headers = { "content-type": "application/json" };
    }
    const response = await request(action.path, options);
    if (response.ok) return null;
    const bodyText = await response.text();
    let detail = bodyText.trim();
    try {
      const payload: unknown = JSON.parse(bodyText);
      if (typeof payload === "object" && payload !== null) {
        const message: unknown = Reflect.get(payload, "error") ?? Reflect.get(payload, "message");
        if (typeof message === "string") detail = message;
      }
    } catch {
      // The supervisor also returns plain-text HTTP errors.
    }
    return `${action.failureLabel}: ${detail || response.statusText}`;
  } catch (error: unknown) {
    return `${action.failureLabel}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
