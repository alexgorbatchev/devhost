import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
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

export interface IPromoFootageSlot {
  id: string;
  sourceId: string;
  outputPath: string;
  duration: number;
  // Seconds into the recording; a negative offset counts back from its end, as in Array.prototype.slice.
  from: number;
  to: number | undefined;
}

export interface IPromoFootagePlan {
  startSeconds: number;
  sourceSeconds: number;
  speed: number;
  holdSeconds: number;
}

export interface IPromoFootageRequest {
  file: string;
  slot: IPromoFootageSlot;
}

export interface IStagedPromoFootage extends IPromoFootageSlot, IPromoFootagePlan {}

export type PromoFootageSource = Pick<IRecordedSourceClip, "id" | "path">;

export type RenderPromoComposition = (projectPath: string, outputPath: string, signal: AbortSignal) => Promise<void>;

export interface IRenderPromoOptions {
  directoryPath: string;
  projectSourcePath: string;
  render: RenderPromoComposition;
  signal: AbortSignal;
}

export interface IPromoNarrationLine {
  id: string;
  text: string;
}

export interface IPromoWord {
  text: string;
  start: number;
  end: number;
}

export interface IPromoLineTiming {
  id: string;
  path: string;
  duration: number;
  words: IPromoWord[];
}

export interface IPromoMusicTiming {
  path: string;
  duration: number;
}

export interface IPromoAudioTimings {
  lines: IPromoLineTiming[];
  music?: IPromoMusicTiming;
}

export interface IPromoAudioApi {
  speak: (
    voiceId: string,
    request: ElevenLabs.BodyTextToSpeechFullWithTimestamps,
  ) => Promise<ElevenLabs.AudioWithTimestampsResponse>;
  compose: (request: ElevenLabs.BodyComposeMusicV1MusicPost) => Promise<ReadableStream<Uint8Array>>;
}
