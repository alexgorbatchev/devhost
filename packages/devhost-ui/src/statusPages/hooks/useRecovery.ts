import { useEffect, useRef, useState } from "react";
import type { IRecoveryClient, IWorktreeSelection, RecoveryState } from "../types";

interface IRecoveryView {
  state: RecoveryState;
  error: string;
  isBusy: boolean;
  isConnected: boolean;
  hasWorktrees: boolean;
  restart: () => Promise<void>;
  refresh: () => Promise<void>;
  select: (selection: IWorktreeSelection) => Promise<void>;
}

export function useRecovery(initial: RecoveryState, client: IRecoveryClient): IRecoveryView {
  const [state, setState] = useState(initial);
  const [error, setError] = useState("");
  const [isBusy, setBusy] = useState(false);
  const [isConnected, setConnected] = useState(false);
  const [hasWorktrees, setWorktrees] = useState(initial.repositories.length === 0);
  const busy = useRef(false);
  const revision = useRef(0);
  const lifetime = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hasLoadedWorktrees = initial.repositories.length === 0;
    async function poll(): Promise<void> {
      const startedAtRevision = revision.current;
      try {
        const next = await client.readStatus(controller.signal);
        if (!hasLoadedWorktrees && !busy.current) {
          next.repositories = await client.readWorktrees(controller.signal);
          hasLoadedWorktrees = true;
          setWorktrees(true);
        }
        if (controller.signal.aborted || startedAtRevision !== revision.current) return;
        setConnected(true);
        setState({
          ...next,
          title: next.phase === "ready" ? initial.title : next.title,
          message: next.phase === "ready" ? initial.message : next.message,
        });
        if (next.phase === "ready" && !busy.current && (await client.probe(controller.signal))) {
          if (!controller.signal.aborted && !busy.current && startedAtRevision === revision.current) client.reload();
        }
      } catch (failure) {
        if (controller.signal.aborted || startedAtRevision !== revision.current) return;
        setConnected(false);
        setState((current) => ({ ...current, message: failure instanceof Error ? failure.message : String(failure) }));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      lifetime.current = null;
    };
  }, [client, initial]);

  useEffect(() => {
    document.title = `${state.title} · devhost`;
  }, [state.title]);

  async function act(operation: IRecoveryClient["restart"]): Promise<void> {
    const controller = lifetime.current;
    if (busy.current || !controller || controller.signal.aborted) return;
    busy.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      await operation(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      busy.current = false;
      revision.current++;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return {
    state,
    error,
    isBusy,
    isConnected,
    hasWorktrees,
    restart: () => act(client.restart),
    refresh: () =>
      act(async (signal) => {
        const repositories = await client.readWorktrees(signal);
        if (!signal.aborted) {
          setState((current) => ({ ...current, repositories }));
          setWorktrees(true);
        }
      }),
    select: (selection) =>
      act(async (signal) => {
        await client.switchWorktree(selection, signal);
        if (!signal.aborted) client.reload();
      }),
  };
}
