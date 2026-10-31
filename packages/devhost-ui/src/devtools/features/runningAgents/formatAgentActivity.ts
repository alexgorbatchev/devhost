const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

/** How long ago an agent was last active, in its largest whole unit. */
export function formatAgentActivity(lastActivity: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - lastActivity) / 1000));
  if (seconds < SECONDS_PER_MINUTE) return "just now";
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h ago`;
  return `${Math.floor(hours / HOURS_PER_DAY)}d ago`;
}
