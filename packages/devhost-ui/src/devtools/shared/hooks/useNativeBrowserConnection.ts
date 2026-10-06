import { useCallback, useEffect, useRef, useState } from "react";
import { pristineFetch, pristineWebSocket } from "../pristineFetch";
import { createNativeBrowserClient } from "../nativeBrowser/createNativeBrowserClient";
import { createNativeBrowserDocumentID } from "../nativeBrowser/createNativeBrowserDocumentID";
import { createNativeBrowserView } from "../nativeBrowser/createNativeBrowserView";
import type { INativeBrowserClient, INativeBrowserView } from "../nativeBrowser/types";

interface INativeBrowserConnectionResult {
  view: INativeBrowserView;
  connect: () => Promise<void>;
  disconnect: () => void;
  openReact: () => void;
}

export function useNativeBrowserConnection(isEnabled: boolean): INativeBrowserConnectionResult {
  const clientReference = useRef<INativeBrowserClient | null>(null);
  const hasNativeSessionLossReference = useRef<boolean>(false);
  const [view, setView] = useState<INativeBrowserView>(createNativeBrowserView);

  useEffect(() => {
    setView(createNativeBrowserView());
    if (!isEnabled) return;
    const client = createNativeBrowserClient({
      hasNativeSessionLoss: hasNativeSessionLossReference.current,
      documentId: createNativeBrowserDocumentID(globalThis.crypto),
      fetch: pristineFetch,
      createSocket: pristineWebSocket,
      getHref: (): string => window.location.href,
    });
    clientReference.current = client;
    const unsubscribe = client.subscribe(() => {
      const current = client.getSnapshot();
      hasNativeSessionLossReference.current ||= current.observation?.isNativeSessionLost === true;
      setView(current);
    });
    return (): void => {
      unsubscribe();
      client.dispose();
      clientReference.current = null;
    };
  }, [isEnabled]);

  const connect = useCallback(async (): Promise<void> => {
    await clientReference.current?.connect();
  }, []);
  const disconnect = useCallback((): void => {
    clientReference.current?.disconnect();
  }, []);
  const openReact = useCallback((): void => {
    clientReference.current?.openReact();
  }, []);
  return { view, connect, disconnect, openReact };
}
