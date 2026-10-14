import { join } from "node:path";
import { viewport } from "./constants";
import type { ICaptionRecording, IRecordedSourceClip, ReadClock, ScreencastControls } from "./types";

export async function createCaptionRecording(
  screencast: ScreencastControls,
  directoryPath: string,
  sceneId: string,
  initialCaption: string,
  captureScale: number = 1,
  now: ReadClock = () => performance.now(),
): Promise<ICaptionRecording> {
  const size = { width: viewport.width * captureScale, height: viewport.height * captureScale };
  const clips: IRecordedSourceClip[] = [];
  const createClip = (caption: string): IRecordedSourceClip => {
    const id = `${sceneId}-${clips.length + 1}`;
    return { id, path: join(directoryPath, "raw", `${id}.webm`), caption };
  };
  let clip = createClip(initialCaption);
  // A clip's footage starts once its screencast has started.
  const startClip = async (): Promise<number> => {
    await screencast.start({ path: clip.path, size });
    return now();
  };
  let clipStartedAt = await startClip();
  let isPosterMarked = false;
  const finishClip = async (): Promise<void> => {
    await screencast.stop();
    clips.push(clip);
  };
  return {
    changeCaption: async (caption: string): Promise<void> => {
      await finishClip();
      clip = createClip(caption);
      clipStartedAt = await startClip();
    },
    markPoster: (): void => {
      if (isPosterMarked) throw new Error(`The ${sceneId} scene already marked its poster frame`);
      isPosterMarked = true;
      clip.poster = Math.round(now() - clipStartedAt) / 1_000;
    },
    stop: async (): Promise<IRecordedSourceClip[]> => {
      await finishClip();
      return clips;
    },
  };
}
