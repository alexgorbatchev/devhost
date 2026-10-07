import { join } from "node:path";
import { viewport } from "./constants";
import type { ICaptionRecording, IRecordedSourceClip, ScreencastControls } from "./types";

export async function createCaptionRecording(
  screencast: ScreencastControls,
  directoryPath: string,
  sceneId: string,
  initialCaption: string,
): Promise<ICaptionRecording> {
  const clips: IRecordedSourceClip[] = [];
  const createClip = (caption: string): IRecordedSourceClip => {
    const id = `${sceneId}-${clips.length + 1}`;
    return { id, path: join(directoryPath, "raw", `${id}.webm`), caption };
  };
  let clip = createClip(initialCaption);
  await screencast.start({ path: clip.path, size: viewport });
  const finishClip = async (): Promise<void> => {
    await screencast.stop();
    clips.push(clip);
  };
  return {
    changeCaption: async (caption: string): Promise<void> => {
      await finishClip();
      clip = createClip(caption);
      await screencast.start({ path: clip.path, size: viewport });
    },
    stop: async (): Promise<IRecordedSourceClip[]> => {
      await finishClip();
      return clips;
    },
  };
}
