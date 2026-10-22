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

export type RunCommand = (command: string[], options?: ICommandOptions) => Promise<string>;

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
  record: (
    page: Page,
    runtime: IDemoRuntime,
    signal: AbortSignal,
    changeCaption: ChangeCaption,
    markPoster: MarkPoster,
  ) => Promise<void>;
}

export type ChangeCaption = (caption: string) => Promise<void>;

// Marks the frame on screen now as the poster of the scene's guide page.
export type MarkPoster = () => void;

// Milliseconds on a monotonic clock.
export type ReadClock = () => number;

export interface IRecordedSourceClip {
  id: string;
  path: string;
  caption: string;
  // Seconds into the clip of the frame its scene marked as the poster.
  poster?: number;
}

export interface ICaptionRecording {
  changeCaption: ChangeCaption;
  markPoster: MarkPoster;
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

// Picks the moment of a film its poster shows.
export type PosterSeconds = (media: IMediaInfo) => number;

export interface IDemoVideoBlock {
  marker: string;
  name: string;
  label: string;
  media: IMediaInfo;
}

export interface IGuideTerminalStep {
  command: string;
  waitPattern: string;
  holdMs?: number;
  shouldWaitForStack?: boolean;
}

export interface IGuideTerminalScene {
  slug: string;
  steps: IGuideTerminalStep[];
  manifest: string;
  files?: Record<string, string>;
  // Lines the scene adds to the [caddy] table of its devhost config file.
  caddyLines?: string[];
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

export type PreparePromoRenderer = (signal: AbortSignal) => Promise<void>;

export type RemovePromoCache = (path: string) => Promise<void>;

export interface IRenderPromoOptions {
  directoryPath: string;
  projectSourcePath: string;
  // Names the staged project directory and its footage record in the run; `promo` unless a guide film is rendered.
  projectName?: "promo" | "guide";
  // Runs once the directory is known to be a recording and before anything in it changes.
  prepare?: PreparePromoRenderer;
  render: RenderPromoComposition;
  signal: AbortSignal;
}

export interface IGuideFootageWindow {
  // The recording in the run's `raw/` directory, named without its extension.
  sourceId: string;
  // Seconds into that recording; a terminal guide is one recording that its steps divide.
  from?: number;
  to?: number;
}

// Where one step of a terminal guide lies in its recording, in seconds.
export interface IGuideStepWindow {
  from: number;
  to: number;
}

// The guide a recording is rendered for.
export interface IGuideRun {
  slug: string;
  title: string;
}

export interface IGuideClipInput {
  // Names the beat's footage slot, caption and narration line.
  clip: string;
  // The narration spoken over the clip, which is also its on-screen caption.
  text: string;
  footage: IGuideFootageWindow;
  // Seconds into the footage's recording of the frame marked as the guide page's poster.
  poster?: number;
  sourceSeconds: number;
  narrationSeconds: number;
}

export interface IGuideBeat {
  clip: string;
  text: string;
  footage: IGuideFootageWindow;
  // Seconds into the film.
  start: number;
  duration: number;
  narrationStart: number;
  narrationSeconds: number;
}

export interface IGuideIntroInput {
  // The guide's promise, spoken over the title card.
  text: string;
  narrationSeconds: number;
}

export interface IGuideIntro extends IGuideIntroInput {
  narrationStart: number;
}

export interface IGuideFilmPlan {
  duration: number;
  // Seconds into the film of the frame the guide page shows before it plays.
  poster: number;
  introSeconds: number;
  outroSeconds: number;
  intro: IGuideIntro;
  beats: IGuideBeat[];
}

// A spoken line and how long its caption stays on screen.
export interface IGuideCueLine {
  // `intro`, or the name of the clip the line is spoken over.
  id: string;
  text: string;
  narrationStart: number;
  narrationSeconds: number;
  visibleUntil: number;
}

export interface IGuideFilm {
  title: string;
  // What the window shows, as its address bar names it: `terminal`, or the page's hostname.
  address: string;
  plan: IGuideFilmPlan;
  // The generated audio of the intro line (`intro`) and of each clip's line, named after the clip.
  lines: IPromoLineTiming[];
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

export interface IPromoAudioTimings {
  lines: IPromoLineTiming[];
}

export interface IGuideScript {
  // The guide's promise, spoken over the title card.
  intro: string;
  // One line per clip, in the order the clips play and named after them.
  clips: IGuideScriptLine[];
}

export interface IGuideScriptLine {
  clip: string;
  text: string;
}

export interface IGuideNarration {
  voice: INarrationVoice;
  guides: Record<string, IGuideScript>;
}

// A recorded clip of a guide and the part of a recording it shows.
export interface IGuideClipSource {
  clip: string;
  footage: IGuideFootageWindow;
  // Seconds into the footage's recording of the frame marked as the guide page's poster.
  poster?: number;
}

// What a run recorded for a guide. Kept in the run as `guide.json`, so its film can be rendered again.
export interface IGuideRecord {
  slug: string;
  title: string;
  // What the window shows, as its address bar names it: `terminal`, or the page's hostname.
  address: string;
  clips: IGuideClipSource[];
}

export interface IFoundGuideRecording {
  directoryPath: string;
  record: IGuideRecord;
}

export interface IRenderGuideFilmOptions extends IGuideRecord {
  // The run that recorded the guide.
  directoryPath: string;
  // Holds the `guide` template project and the `promo` project, whose renderer pin the guide films share.
  filmPath: string;
  render: RenderPromoComposition;
  signal: AbortSignal;
}

// A guide line's take and what it was generated from.
export interface IGuideLineTiming extends IPromoLineTiming {
  // The SHA-256 of the ElevenLabs request the take answers. A line keeps its take while its request gives this hash.
  requestSha256: string;
}

export interface IGuideAudioTimings {
  // Each guide's lines, named after the clip they are spoken over.
  guides: Record<string, IGuideLineTiming[]>;
}

export interface INarrationVoice {
  id: string;
  name: string;
  model: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speed?: number;
}

export interface ISpokenLineRequest {
  voice: INarrationVoice;
  // Names the line in an error message.
  name: string;
  text: string;
  previousText?: string;
  nextText?: string;
}

export interface ISpokenLine {
  duration: number;
  words: IPromoWord[];
}

// Speaks narration lines.
export interface ISpeechApi {
  speak: (
    voiceId: string,
    request: ElevenLabs.BodyTextToSpeechFullWithTimestamps,
  ) => Promise<ElevenLabs.AudioWithTimestampsResponse>;
}
