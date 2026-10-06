import type { FetchFunction } from "../pristineFetch";

export interface INativeBrowserBinding {
  instanceId: string;
  documentId: string;
  href: string;
}

export interface INativeBrowserObservation {
  isConnected: boolean;
  documentState: "unbound" | "ambiguous" | "bound";
  isReactAvailable: boolean;
  isNativeWindowOpen: boolean;
  isNativeSessionLost: boolean;
  browserVersion: string;
  message: string;
}

export interface INativeBrowserStateUpdate {
  type: "state";
  id?: string;
  revision: number;
  state: INativeBrowserObservation;
  error?: string;
}

export interface INativeBrowserErrorUpdate {
  type: "error";
  id?: string;
  error: string;
}

export type NativeBrowserUpdate = INativeBrowserStateUpdate | INativeBrowserErrorUpdate;

export interface INativeBrowserView {
  connectionStatus: "disconnected" | "connecting" | "connected";
  observation: INativeBrowserObservation | null;
  isActionPending: boolean;
  errorMessage: string | null;
  binding: INativeBrowserBinding | null;
}

export interface INativeBrowserClientOptions {
  hasNativeSessionLoss: boolean;
  documentId: string;
  fetch: FetchFunction;
  createSocket: (url: string | URL, protocols?: string | string[]) => WebSocket;
  getHref: () => string;
}

export interface INativeBrowserClient {
  connect: () => Promise<void>;
  disconnect: () => void;
  openReact: () => void;
  getSnapshot: () => INativeBrowserView;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
}
