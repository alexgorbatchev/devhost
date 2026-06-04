import type { IStandardSourceShape } from "./reactSourceInspection";

export type ServiceHealth = {
  managed: boolean;
  name: string;
  status: boolean;
  url?: string;
  dirty?: boolean; // Indicates file changes have been detected
  restarting?: boolean; // Indicates service is actively in process of restarting
};

export type HealthResponse = {
  services: ServiceHealth[];
};

export type ServiceLogStream = "stdout" | "stderr";

export type ServiceLogEntry = {
  id: number;
  line: string;
  serviceName: string;
  stream: ServiceLogStream;
};

export type ServiceLogSnapshotMessage = {
  entries: ServiceLogEntry[];
  type: "snapshot";
};

export type ServiceLogUpdateMessage = {
  entry: ServiceLogEntry;
  type: "entry";
};

export type ServiceLogMessage = ServiceLogSnapshotMessage | ServiceLogUpdateMessage;

type ReactFunctionLocationTuple = [string, string, number, number];

export type NormalizedSourceValue = ReactFunctionLocationTuple | IStandardSourceShape | null | undefined;

export type WebSocketMessageData = string | ArrayBuffer | Uint8Array;

export interface ILocationHostProtocol {
  host: string;
  protocol: string;
}
