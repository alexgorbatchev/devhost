import type { ValidatedDevhostAgent } from "./stackTypes";

export function createDefaultDevhostAgent(): ValidatedDevhostAgent {
  return {
    displayName: "Pi",
    kind: "pi",
  };
}
