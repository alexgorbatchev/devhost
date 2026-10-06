import type { BrowserContext } from "playwright";
import type { EnhancedStore } from "@redux-devtools/instrument";
import type { Action } from "redux";
import type { registerReduxDevtoolsStore, registerZustandDevtoolsStore } from "../../index";

export interface INativeReduxHost {
  url: string;
  rootPath: string;
  close: () => Promise<void>;
}
export interface INativeReduxHostOptions {
  isExtensionEnabled?: boolean;
  hasUntrustedFixtureCertificate?: boolean;
}
export type NativeReduxHostTest = (host: INativeReduxHost, browser: BrowserContext) => Promise<void>;
export interface ICounterFixtureState {
  count: number;
  increment: () => void;
}
export interface ICounterFixtureSnapshot {
  count: number;
}
export interface IRichCounterFixtureSnapshot extends ICounterFixtureSnapshot {
  createdAt: Date;
  values: Map<string, number>;
  flags: Set<string>;
  optional: undefined;
  self?: IRichCounterFixtureSnapshot;
}
export interface IReduxFixture {
  store: EnhancedStore<ICounterFixtureSnapshot, Action<string>, unknown>;
  increment: () => Action<string>;
}
export interface INativeReduxFixtureReadResult {
  toolkit: number[];
  zustand: number[];
  hasActions: boolean[];
  isHookUnchanged: boolean;
  hasNativeZustandMiddleware: boolean[];
  toolkitActionIds: number[][];
  isZustandBoundStore: boolean[];
  hasOriginalActions: boolean[];
}
export interface INativeReduxFixture {
  read: () => INativeReduxFixtureReadResult;
  register: () => void;
  unregister: () => void;
  registerInvalid: () => void;
  replace: () => void;
  openExtension: () => void;
}
export interface IReduxHostRegistrationApi {
  registerReduxDevtoolsStore: typeof registerReduxDevtoolsStore;
  registerZustandDevtoolsStore: typeof registerZustandDevtoolsStore;
}
declare global {
  interface Window {
    reduxNativeFixture: INativeReduxFixture;
  }
}
