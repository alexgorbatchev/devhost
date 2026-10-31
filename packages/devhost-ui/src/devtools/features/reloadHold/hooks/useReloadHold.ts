import { useCallback, useEffect, useState } from "react";
import { readIsOwnReloadPending } from "../../../shared/reloadPage";

interface IReloadHold {
  /** Whether this browser can hold reloads at all. */
  isAvailable: boolean;
  isBlocked: boolean;
  dismiss: VoidFunction;
}

/**
 * Holds reloads a script asks for, which is how dev servers refresh a page, through the Navigation API: nothing of the
 * host's is patched. A reload the person asks for from the browser is left alone. A script's reload cannot be told
 * from a dev server's, so the application's own reloads are held too, and the notice offers them back.
 */
export function useReloadHold(isEnabled: boolean): IReloadHold {
  const [isBlocked, setIsBlocked] = useState(false);
  const isAvailable = "navigation" in window;
  useEffect(() => {
    if (!isEnabled || !isAvailable) {
      setIsBlocked(false);
      return;
    }
    const hold = (event: NavigateEvent): void => {
      if (event.navigationType !== "reload" || !event.cancelable) return;
      // Chromium fires no event for a reload from the browser's own controls; the spec lets others report one here.
      if (event.userInitiated || readIsOwnReloadPending()) return;
      event.preventDefault();
      setIsBlocked(true);
    };
    window.navigation.addEventListener("navigate", hold);
    return () => window.navigation.removeEventListener("navigate", hold);
  }, [isAvailable, isEnabled]);
  const dismiss = useCallback((): void => setIsBlocked(false), []);
  return { isAvailable, isBlocked, dismiss };
}
