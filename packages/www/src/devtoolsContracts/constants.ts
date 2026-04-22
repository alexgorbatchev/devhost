const controlPathPrefix: string = "/__devhost__";

export const XTERM_STYLESHEET_PATH: string = `${controlPathPrefix}/xterm.css`;
export const TERMINAL_SESSION_START_PATH: string = `${controlPathPrefix}/terminal-sessions`;
export const HEALTH_WEBSOCKET_PATH: string = `${controlPathPrefix}/ws/health`;
export const LOGS_WEBSOCKET_PATH: string = `${controlPathPrefix}/ws/logs`;
export const RESTART_SERVICE_PATH: string = `${controlPathPrefix}/restart-service`;
export const TERMINAL_SESSION_WEBSOCKET_PATH: string = `${controlPathPrefix}/ws/terminal`;
export const ANNOTATION_QUEUES_WEBSOCKET_PATH: string = `${controlPathPrefix}/ws/annotation-queues`;
export const DEVTOOLS_CONTROL_TOKEN_HEADER_NAME: string = "x-devhost-control-token";
export const DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME: string = "token";
export const TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME: string = "sessionId";
