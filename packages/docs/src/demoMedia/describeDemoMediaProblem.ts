import type { IDemoMediaFileState } from "./types";

export function describeDemoMediaProblem({ name, state }: IDemoMediaFileState): string | undefined {
  if (state === "missing") return `${name} is not downloaded: run \`just docs media\``;
  if (state === "different") {
    return `${name} is not the published video: publish this render with \`just docs publish-media\`, or delete it and run \`just docs media\``;
  }
  if (state === "unpinned") return `${name} is not published: run \`just docs publish-media\``;
  return undefined;
}
