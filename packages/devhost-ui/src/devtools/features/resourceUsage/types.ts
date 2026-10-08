export interface ICpuUsage {
  /** Share of all logical CPUs that was busy since the previous reading, 0 to 100. */
  percent: number;
  cores: number;
}

export interface ISpaceUsage {
  percent: number;
  usedBytes: number;
  totalBytes: number;
}

/** The latest host readings. A readout is absent while it is off, not read yet, or failing. */
export interface IResourceUsage {
  cpu?: ICpuUsage;
  memory?: ISpaceUsage;
  disk?: ISpaceUsage;
}

export type ResourceReadoutKey = "cpu" | "memory" | "disk";

export type ResourceLevel = "normal" | "warning" | "danger";

export interface IResourceReadout {
  key: ResourceReadoutKey;
  label: string;
  /** Whole percent, as shown. */
  percent: number;
  /** The absolute figures behind the percentage. */
  detail: string;
  level: ResourceLevel;
}
