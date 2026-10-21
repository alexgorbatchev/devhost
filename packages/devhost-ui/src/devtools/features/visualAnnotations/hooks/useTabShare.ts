import { useCallback, useEffect, useRef, useState } from "react";
import { requestTabShare } from "../requestTabShare";

interface ITabShare {
  stream: MediaStream | undefined;
  isRequesting: boolean;
  error: string | null;
  share: () => Promise<void>;
  stop: () => void;
}
interface IShareLifetime {
  active: boolean;
  stream: MediaStream | undefined;
  request: number;
}

export function useTabShare(): ITabShare {
  const [stream, setStream] = useState<MediaStream>();
  const [isRequesting, setIsRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef<IShareLifetime>({ active: true, stream: undefined, request: 0 });
  const stop = useCallback((): void => {
    lifetime.current.request += 1;
    for (const track of lifetime.current.stream?.getTracks() ?? []) track.stop();
    lifetime.current.stream = undefined;
    setStream(undefined);
    setIsRequesting(false);
  }, []);
  useEffect(() => {
    const state = lifetime.current;
    state.active = true;
    return () => {
      state.active = false;
      state.request += 1;
      for (const track of state.stream?.getTracks() ?? []) track.stop();
      state.stream = undefined;
    };
  }, []);
  const share = useCallback(async (): Promise<void> => {
    const state = lifetime.current;
    const request = ++state.request;
    setIsRequesting(true);
    setError(null);
    try {
      const next = await requestTabShare(navigator.mediaDevices);
      if (!state.active || request !== state.request) {
        for (const track of next.getTracks()) track.stop();
        return;
      }
      for (const track of state.stream?.getTracks() ?? []) track.stop();
      state.stream = next;
      setStream(next);
      next.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
    } catch (error) {
      if (state.active && request === state.request) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (state.active && request === state.request) setIsRequesting(false);
    }
  }, [stop]);
  return { stream, isRequesting, error, share, stop };
}
