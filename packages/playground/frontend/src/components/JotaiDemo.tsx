// jotai-devtools instruments the stores created after it loads, so it is imported before the store is created.
import { DevTools } from "jotai-devtools";
import "jotai-devtools/styles.css";
import { atom, createStore, Provider, useAtom } from "jotai";
import type { JSX } from "react";

const countAtom = atom(0);
countAtom.debugLabel = "count";
const store = createStore();

function JotaiCounter(): JSX.Element {
  const [count, setCount] = useAtom(countAtom);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Jotai count: {count}
    </button>
  );
}

export function JotaiDemo(): JSX.Element {
  return (
    <section className="inspector-demo" aria-labelledby="jotai-title">
      <h2 id="jotai-title">Jotai</h2>
      <Provider store={store}>
        <JotaiCounter />
      </Provider>
      <DevTools store={store} position="bottom-left" />
    </section>
  );
}
