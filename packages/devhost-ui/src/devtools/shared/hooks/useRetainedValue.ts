import { useState } from "react";

/**
 * Returns `value` while `isActive`, and the last active value once `isActive` turns false.
 *
 * Fading surfaces stay mounted during their exit transition; retaining the last content keeps them from
 * flashing an empty state while they fade out.
 */
export function useRetainedValue<TValue>(value: TValue, isActive: boolean): TValue {
  const [retainedValue, setRetainedValue] = useState<TValue>(value);

  if (isActive && retainedValue !== value) {
    setRetainedValue(value);
  }

  return isActive ? value : retainedValue;
}
