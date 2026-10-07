import createCache, { type EmotionCache } from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { App } from "@redux-devtools/app-core";
import { Provider } from "react-redux";
import type { JSX } from "react";
import type { CoreStoreAction, CoreStoreState } from "@redux-devtools/app-core";
import type { Store } from "redux";

interface IReduxDevtoolsMonitorProps {
  store: Store<CoreStoreState, CoreStoreAction>;
}

const monitorStyleCache: EmotionCache = createMonitorStyleCache();

export function ReduxDevtoolsMonitor({ store }: IReduxDevtoolsMonitorProps): JSX.Element {
  return (
    <CacheProvider value={monitorStyleCache}>
      <Provider store={store}>
        <App />
      </Provider>
    </CacheProvider>
  );
}

/**
 * The cache the upstream inspector's Emotion styles go through. It is the cache Emotion would create by default,
 * under the same key and so with the same class names, except that it is marked `compat`: the monitor is rendered
 * in the browser only, and upstream's `:first-child` and `:nth-child` selectors are safe there. Without the mark,
 * Emotion's development build logs each of them as unsafe for server-side rendering.
 */
function createMonitorStyleCache(): EmotionCache {
  const cache: EmotionCache = createCache({ key: "css" });

  cache.compat = true;

  return cache;
}
