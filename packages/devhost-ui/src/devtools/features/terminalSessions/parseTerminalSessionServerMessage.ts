import type { TerminalSessionServerMessage } from "./types";

/** Reads one frame of the terminal session stream. The result is `null` for a frame that is not a session message. */
export function parseTerminalSessionServerMessage(frame: unknown): TerminalSessionServerMessage | null {
  if (typeof frame !== "string") {
    return null;
  }

  const parsedValue: unknown = parseJson(frame);

  if (typeof parsedValue !== "object" || parsedValue === null) {
    return null;
  }

  const messageType: unknown = Reflect.get(parsedValue, "type");

  if (messageType === "snapshot" || messageType === "output") {
    const data: unknown = Reflect.get(parsedValue, "data");

    if (typeof data !== "string") {
      return null;
    }

    return {
      data,
      type: messageType,
    };
  }

  if (messageType === "exit") {
    const exitCode: unknown = Reflect.get(parsedValue, "exitCode");
    const signalCode: unknown = Reflect.get(parsedValue, "signalCode");

    if (
      (typeof exitCode !== "number" && exitCode !== null) ||
      (typeof signalCode !== "string" && signalCode !== null)
    ) {
      return null;
    }

    return {
      exitCode,
      signalCode,
      type: "exit",
    };
  }

  if (messageType === "error") {
    const errorMessage: unknown = Reflect.get(parsedValue, "message");

    if (typeof errorMessage !== "string") {
      return null;
    }

    return {
      message: errorMessage,
      type: "error",
    };
  }

  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
