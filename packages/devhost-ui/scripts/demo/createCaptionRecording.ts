import { join } from "node:path";
import type { Screencast } from "playwright";
import { viewport } from "./constants";
import type { CaptionRecording, RecordedSourceClip } from "./types";

export async function createCaptionRecording(
  screencast: Pick<Screencast, "start" | "stop">,
  directoryPath: string,
  sceneId: string,
  initialCaption: string,
): Promise<CaptionRecording> {
  const clips: RecordedSourceClip[] = [];
  const createClip = (caption: string): RecordedSourceClip => {
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
    stop: async (): Promise<RecordedSourceClip[]> => {
      await finishClip();
      return clips;
    },
  };
}
