const AGENT_ACTIVITY_STREAM_PATH = "/__devhost__/ws/agents/activity";

interface IPageLocation {
  host: string;
  search: string;
}

/** The stream for the checkout this page was opened for, which its query names. */
export function createAgentActivityStreamURL(location: IPageLocation): string {
  return `ws://${location.host}${AGENT_ACTIVITY_STREAM_PATH}${location.search}`;
}
