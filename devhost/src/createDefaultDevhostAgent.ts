import type { IValidatedDevhostAgent } from "./stackTypes";

export function createDefaultDevhostAgent(): IValidatedDevhostAgent {
  return {
    displayName: "Pi",
    kind: "pi",
  };
}
