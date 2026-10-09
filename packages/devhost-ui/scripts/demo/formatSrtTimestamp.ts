export function formatSrtTimestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1_000);
  const hours = Math.floor(milliseconds / 3_600_000)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((milliseconds / 60_000) % 60)
    .toString()
    .padStart(2, "0");
  const wholeSeconds = Math.floor((milliseconds / 1_000) % 60)
    .toString()
    .padStart(2, "0");
  const fraction = (milliseconds % 1_000).toString().padStart(3, "0");
  return `${hours}:${minutes}:${wholeSeconds},${fraction}`;
}
