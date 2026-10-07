import type { Page, Screencast } from "playwright";

export type ScreencastAction = "start" | "stop";
export type ScreencastControls = Pick<Screencast, ScreencastAction>;

export interface ICommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  logPath?: string;
}

export interface ICaptionClip {
  caption: string;
  duration: number;
}

export interface IDemoRuntime {
  directoryPath: string;
  repositoryPath: string;
  manifestPath: string;
  adminAddress: string;
  certificatePath: string;
  url: string;
  env: NodeJS.ProcessEnv;
}

export interface IBrowserScene {
  id: string;
  caption: string;
  record: (page: Page, runtime: IDemoRuntime, signal: AbortSignal, changeCaption: ChangeCaption) => Promise<void>;
}

export type ChangeCaption = (caption: string) => Promise<void>;

export interface IRecordedSourceClip {
  id: string;
  path: string;
  caption: string;
}

export interface ICaptionRecording {
  changeCaption: ChangeCaption;
  stop: () => Promise<IRecordedSourceClip[]>;
}

export interface IRecordedClip extends ICaptionClip {
  id: string;
  path: string;
}

export interface IMediaInfo {
  duration: number;
  width: number;
  height: number;
}

export interface IGuideTerminalStep {
  command: string;
  waitPattern: string;
  holdMs?: number;
  shouldWaitForStack?: boolean;
}

export interface IGuideTerminalScene {
  slug: string;
  caption: string;
  steps: IGuideTerminalStep[];
  manifest: string;
  files?: Record<string, string>;
  isPrivateCaddy?: boolean;
  isDocker?: boolean;
  daemonPort?: number;
  dockerPort?: number;
}
