// A video's name is joined to the media directory and becomes a manifest key, so it names a video and nothing else.
export function isDemoMediaName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.mp4$/.test(name);
}
