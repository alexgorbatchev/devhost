import type { ValidatedDevhostAgent } from "../types/stackTypes";

export function createDefaultDevhostAgent(): ValidatedDevhostAgent {
  return {
    displayName: "Pi",
    kind: "pi",
  };
}
