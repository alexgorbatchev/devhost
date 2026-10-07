import type { Page } from "playwright";

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  logPath?: string;
}

export interface CaptionClip {
  caption: string;
  duration: number;
}

export interface DemoRuntime {
  directoryPath: string;
  repositoryPath: string;
  manifestPath: string;
  adminAddress: string;
  certificatePath: string;
  url: string;
  env: NodeJS.ProcessEnv;
}

export interface BrowserScene {
  id: string;
  caption: string;
  record: (page: Page, runtime: DemoRuntime, signal: AbortSignal, changeCaption: ChangeCaption) => Promise<void>;
}

export type ChangeCaption = (caption: string) => Promise<void>;

export interface RecordedSourceClip {
  id: string;
  path: string;
  caption: string;
}

export interface CaptionRecording {
  changeCaption: ChangeCaption;
  stop: () => Promise<RecordedSourceClip[]>;
}

export interface RecordedClip extends CaptionClip {
  id: string;
  path: string;
}

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
}
