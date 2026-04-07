import type { IStandardSourceShape } from "./reactSourceInspection";

export type ServiceHealth = {
  name: string;
  status: boolean;
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
