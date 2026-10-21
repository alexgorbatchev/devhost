export const CONTROL_PATH_PREFIX: string = "/__devhost__";
export const HEALTH_WEBSOCKET_PATH: string = `${CONTROL_PATH_PREFIX}/ws/health`;
export const LOGS_WEBSOCKET_PATH: string = `${CONTROL_PATH_PREFIX}/ws/logs`;
export const RESOURCES_WEBSOCKET_PATH: string = `${CONTROL_PATH_PREFIX}/ws/resources`;
export const RESTART_SERVICE_PATH: string = `${CONTROL_PATH_PREFIX}/restart-service`;
export const RESTART_STACK_PATH: string = `${CONTROL_PATH_PREFIX}/restart-stack`;
export const START_SERVICE_PATH: string = `${CONTROL_PATH_PREFIX}/start-service`;
export const REACT_HIGHLIGHT_WEBSOCKET_PATH: string = `${CONTROL_PATH_PREFIX}/ws/react-highlight`;
export const DEVHOST_SERVICE_NAME: string = "devhost";
export const DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME: string = "__DEVHOST_INJECTED_CONFIG__";
export const DEVTOOLS_HOST_ID: string = "devhost-devtools-host";
export const DEVTOOLS_ROOT_ID: string = "devhost-devtools-root";
export const DEVTOOLS_ROOT_ATTRIBUTE_NAME: string = "data-devhost-devtools";
// Matches elements the browser renders in its top layer: open popovers and modal dialogs.
export const TOP_LAYER_ELEMENT_SELECTOR: string = ":popover-open, :modal";
export const DEVTOOLS_FONT_FAMILY: string = "devhost JetBrains Mono";
export const maximumRetainedLogEntries: number = 512;
export const DEFAULT_RESTART_SERVICES_SHORTCUT: string = "alt+ctrl+r";
