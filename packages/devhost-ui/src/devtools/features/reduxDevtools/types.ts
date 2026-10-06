import type { Request } from "@redux-devtools/app-core";
import type { EnhancedStore, LiftedAction, LiftedState } from "@redux-devtools/instrument";
import type { Action } from "redux";
import type { StoreApi } from "zustand/vanilla";
import type { ZodType } from "zod";

export type NativeReduxStore = EnhancedStore<unknown, Action<string>, unknown>;
export type NativeLiftedState = LiftedState<unknown, Action<string>, unknown>;
export type NativeLiftedAction = LiftedAction<unknown, Action<string>, unknown>;
export interface IReduxDevtoolsRegistrationOptions {
  id: string;
  name: string;
  store: unknown;
}
export interface IZustandDevtoolsRegistrationOptions<State, Snapshot> {
  id: string;
  name: string;
  store: StoreApi<State>;
  snapshot: (state: State) => Snapshot;
  restore: (snapshot: unknown, current: State) => Partial<State>;
}
export interface IDisconnectMessage {
  type: "DISCONNECTED";
  id: string;
}
export interface IProducerErrorMessage {
  type: "ERROR";
  id: string;
  message: string;
}
export type ProducerMessage = Request | IDisconnectMessage | IProducerErrorMessage;
export interface IMonitorHello {
  type: "DEVHOST_REDUX_HELLO";
  sessionId: string;
}
export interface IMonitorStart {
  type: "START";
}
export interface IMonitorStop {
  type: "STOP";
}
export interface IMonitorDispatch {
  type: "DISPATCH";
  instanceId: string;
  action: unknown;
  state?: string;
  isToAll: boolean;
}
export type MonitorMessage = IMonitorStart | IMonitorStop | IMonitorDispatch;
export interface IReduxDevtoolsProducer {
  subscribe: (send: (message: ProducerMessage) => void) => () => void;
  receive: (message: IMonitorDispatch) => void;
  kind: "redux" | "zustand";
}
export interface IReduxDevtoolsRegistration {
  id: string;
  name: string;
  connectionId: string;
  createProducer: () => IReduxDevtoolsProducer;
}
export interface IReduxDevtoolsRegistry {
  version: 1;
  read: () => readonly IReduxDevtoolsRegistration[];
  register: (registration: IReduxDevtoolsRegistration) => () => void;
  subscribe: (onChange: () => void) => () => void;
}
export interface IReduxDevtoolsSchemas {
  liftedState: ZodType<NativeLiftedState>;
  liftedAction: ZodType<NativeLiftedAction>;
  monitorMessage: ZodType<MonitorMessage>;
  hello: ZodType<IMonitorHello>;
}
export interface IReduxDevtoolsSession {
  isOpen: () => boolean;
  readTitle: () => string;
  open: () => void;
  close: () => void;
  subscribe: (onChange: () => void) => () => void;
}
export interface IConnectedReduxDevtoolsProducer {
  registration: IReduxDevtoolsRegistration;
  producer: IReduxDevtoolsProducer;
  unsubscribe: () => void;
}
