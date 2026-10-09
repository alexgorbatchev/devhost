import { expect, it } from "bun:test";
import { createPromoCaptions } from "../createPromoCaptions";
import type { IPromoAudioTimings } from "../types";

const timings: IPromoAudioTimings = {
  lines: [
    { id: "line-1", path: "assets/audio/voice/line-1.mp3", duration: 4.13, words: [] },
    { id: "line-2", path: "assets/audio/voice/line-2.mp3", duration: 2.5, words: [] },
  ],
};
const lines = [
  { id: "line-1", text: "Which port?" },
  { id: "line-2", text: "Stop juggling ports." },
];

it("captions each narration line from where the composition starts its audio", async () => {
  const html = `<div id="root" data-composition-id="main">
    <audio id="music" src="assets/audio/music.mp3" data-start="0" data-duration="42"></audio>
    <audio id="voice-line-1" data-narration="line-1" src="assets/audio/voice/line-1.mp3" data-start="0.25"></audio>
    <audio id="voice-line-2" data-narration="line-2" src="assets/audio/voice/line-2.mp3" data-start="3.5"></audio>
  </div>`;

  expect(await createPromoCaptions(html, lines, timings)).toBe(
    [
      "1\n00:00:00,250 --> 00:00:03,500\nWhich port?\n",
      "2\n00:00:03,500 --> 00:00:06,000\nStop juggling ports.\n",
    ].join("\n"),
  );
});

it("ends a caption when the composition cuts its audio clip short", async () => {
  const html = `<div id="root" data-composition-id="main">
    <audio id="voice-line-1" data-narration="line-1" src="a.mp3" data-start="0.25" data-duration="3"></audio>
    <audio id="voice-line-2" data-narration="line-2" src="b.mp3" data-start="6" data-duration="2"></audio>
  </div>`;

  expect(await createPromoCaptions(html, lines, timings)).toBe(
    [
      "1\n00:00:00,250 --> 00:00:03,250\nWhich port?\n",
      "2\n00:00:06,000 --> 00:00:08,000\nStop juggling ports.\n",
    ].join("\n"),
  );
});

it("rejects a narration clip whose length is not a positive number", async () => {
  const html = `<audio id="voice-line-1" data-narration="line-1" src="a.mp3" data-start="0.25" data-duration="3s"></audio>
    <audio id="voice-line-2" data-narration="line-2" src="b.mp3" data-start="6"></audio>`;

  await expect(createPromoCaptions(html, lines, timings)).rejects.toThrow(
    "Narration clip line-1 has an invalid data-duration: 3s",
  );
});

it("names a narration line the composition never plays", async () => {
  const html = '<audio id="voice-line-1" data-narration="line-1" src="a.mp3" data-start="0.25"></audio>';

  await expect(createPromoCaptions(html, lines, timings)).rejects.toThrow(
    "The composition has no audio clip for narration line line-2",
  );
});
