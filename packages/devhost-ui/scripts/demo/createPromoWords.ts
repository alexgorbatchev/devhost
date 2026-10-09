import type { ElevenLabs } from "@elevenlabs/elevenlabs-js";
import type { IPromoWord } from "./types";

export function createPromoWords(alignment: ElevenLabs.CharacterAlignmentResponseModel): IPromoWord[] {
  const { characters, characterStartTimesSeconds: starts, characterEndTimesSeconds: ends } = alignment;
  if (characters.length !== starts.length || characters.length !== ends.length) {
    throw new Error(
      `Speech alignment has ${characters.length} characters but ${starts.length} start times and ${ends.length} end times`,
    );
  }
  const words: IPromoWord[] = [];
  let word: IPromoWord | undefined;
  for (const [index, character] of characters.entries()) {
    if (character.trim() === "") {
      word = undefined;
      continue;
    }
    const end = ends[index] ?? 0;
    if (word) {
      word.text += character;
      word.end = end;
    } else {
      word = { text: character, start: starts[index] ?? 0, end };
      words.push(word);
    }
  }
  return words;
}
