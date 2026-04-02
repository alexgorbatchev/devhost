import createEmotion from "@emotion/css/create-instance";

const devtoolsEmotionKey: string = "devhost";

type EmotionInstance = ReturnType<typeof createEmotion>;

let emotionInstance: EmotionInstance | null = null;

export function configureDevtoolsCss(container: Node): void {
  emotionInstance = createEmotion({
    container,
    key: devtoolsEmotionKey,
  });
}

export function css(...args: Parameters<EmotionInstance["css"]>): string {
  return readEmotionInstance().css(...args);
}

export function cx(...args: Parameters<EmotionInstance["cx"]>): string {
  return readEmotionInstance().cx(...args);
}

export function injectGlobal(...args: Parameters<EmotionInstance["injectGlobal"]>): void {
  readEmotionInstance().injectGlobal(...args);
}

function readEmotionInstance(): EmotionInstance {
  if (emotionInstance === null) {
    throw new Error("Devtools CSS has not been configured.");
  }

  return emotionInstance;
}
