import { useEffect, useState, useSyncExternalStore, type JSX } from "react";
import { increment, reduxCounterStore } from "../reduxCounterStore";
import { loadDevhostReduxModule } from "../loadDevhostReduxModule";
import { registerDevhostStores } from "../registerDevhostStores";
import { zustandCounterStore } from "../zustandCounterStore";

// Redux Toolkit and Zustand stores that devhost's Redux toolbar entry inspects once they are registered.
export function StoreDevtoolsDemo(): JSX.Element {
  const reduxCount = useSyncExternalStore(reduxCounterStore.subscribe, () => reduxCounterStore.getState().count);
  const zustandCount = useSyncExternalStore(zustandCounterStore.subscribe, () => zustandCounterStore.getState().count);
  const [registrationError, setRegistrationError] = useState<string>();

  useEffect(() => {
    let unregister: (() => void) | undefined;
    let isMounted = true;
    // Registering only while mounted matters: a registration under the same id replaces the current one, so a
    // late registration from an effect that already ended would replace the live one and then remove it.
    loadDevhostReduxModule().then(
      (devhostRedux) => {
        if (isMounted) unregister = registerDevhostStores(devhostRedux);
      },
      (error: unknown) => {
        if (isMounted) setRegistrationError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      isMounted = false;
      unregister?.();
    };
  }, []);

  return (
    <section className="inspector-demo" aria-labelledby="store-devtools-title">
      <h2 id="store-devtools-title">Redux Toolkit and Zustand</h2>
      <button type="button" onClick={() => reduxCounterStore.dispatch(increment())}>
        Redux count: {reduxCount}
      </button>
      <button type="button" onClick={() => zustandCounterStore.getState().increment()}>
        Zustand count: {zustandCount}
      </button>
      {registrationError === undefined ? null : (
        <p role="alert">Open this page through devhost to inspect these stores: {registrationError}</p>
      )}
    </section>
  );
}
