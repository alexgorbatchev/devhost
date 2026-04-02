export const CONTROL_PATH_PREFIX: string = "/__devhost__";
export const INJECTED_SCRIPT_PATH: string = `${CONTROL_PATH_PREFIX}/inject.js`;
export const HEALTH_WEBSOCKET_PATH: string = `${CONTROL_PATH_PREFIX}/ws/health`;
export const LOGS_WEBSOCKET_PATH: string = `${CONTROL_PATH_PREFIX}/ws/logs`;
export const DEVHOST_SERVICE_NAME: string = "devhost";
export const DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME: string = "__DEVHOST_INJECTED_CONFIG__";
export const DEVTOOLS_ROOT_ID: string = "devhost-services-panel";
export const maximumRetainedLogEntries: number = 512;
