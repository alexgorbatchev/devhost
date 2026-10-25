import { vi } from "vitest";
import { installDevtoolsStyles } from "../../../shared/devtoolsStyles";
import { placeElement } from "../../../../../test-support/hostPageUtils";

interface IChatCaptureFixture extends ReturnType<typeof createSharedTabFixture> {
  root: HTMLDivElement;
  chat: HTMLElement;
  button: HTMLButtonElement;
  tools: HTMLDivElement;
  sampling: Promise<void>;
  observer: MutationObserver;
}

export function createChatCaptureFixture(): IChatCaptureFixture {
  const fixture = createSharedTabFixture();
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  installDevtoolsStyles(shadow);
  const root = document.createElement("div");
  const chat = document.createElement("aside");
  chat.setAttribute("data-devhost-capture-exclude", "");
  placeElement(chat, { x: 100, y: 100, width: 300, height: 400 });
  const button = document.createElement("button");
  button.textContent = "Settings";
  placeElement(button, { x: 130, y: 130, width: 80, height: 20 });
  chat.append(button);
  const tools = document.createElement("div");
  tools.setAttribute("data-devhost-capture-exclude", "");
  tools.setAttribute("data-devhost-annotation-controls", "");
  placeElement(tools, { x: 100, y: 10, width: 300, height: 50 });
  root.append(chat, tools);
  shadow.append(root);
  const sampling = Promise.withResolvers<void>();
  const observer = new MutationObserver(() => {
    fixture.context.fillStyle = "lime";
    fixture.context.fillRect(0, 0, fixture.canvas.width, fixture.canvas.height);
    sampling.resolve();
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-devhost-capturing"] });
  return { ...fixture, root, chat, button, tools, sampling: sampling.promise, observer };
}

export function createSharedTabFixture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "red";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const stream = canvas.captureStream(30);
  const track = stream.getVideoTracks()[0]!;
  vi.spyOn(track, "getSettings").mockReturnValue({ displaySurface: "browser" });
  let isBlue = false;
  // A live video source keeps producing frames; the changing corner leaves the sampled red pixels intact.
  const paintFrame = (): void => {
    if (track.readyState !== "live") return;
    isBlue = !isBlue;
    context.fillStyle = isBlue ? "blue" : "red";
    context.fillRect(0, 0, 1, 1);
    requestAnimationFrame(paintFrame);
  };
  requestAnimationFrame(paintFrame);
  return { document, mediaDevices: { getDisplayMedia: async () => stream }, stream, track, canvas, context };
}

export function createResizingChatCaptureFixture() {
  const fixture = createChatCaptureFixture();
  fixture.observer.disconnect();
  let preparations = 0;
  const observer = new MutationObserver(() => {
    const isCapturing = fixture.root.hasAttribute("data-devhost-capturing");
    if (isCapturing) {
      preparations += 1;
      fixture.canvas.height = 24;
    }
    fixture.context.fillStyle = isCapturing ? "lime" : "red";
    fixture.context.fillRect(0, 0, fixture.canvas.width, fixture.canvas.height);
  });
  observer.observe(fixture.root, { attributes: true, attributeFilter: ["data-devhost-capturing"] });
  return { ...fixture, observer, readPreparations: () => preparations };
}

export async function resizeSharedTab(stream: MediaStream, canvas: HTMLCanvasElement, height: number): Promise<void> {
  if (canvas.height === height) return;
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
    const resized = new Promise<void>((resolve) => video.addEventListener("resize", () => resolve(), { once: true }));
    canvas.height = height;
    await resized;
  } finally {
    video.pause();
    video.srcObject = null;
  }
}
