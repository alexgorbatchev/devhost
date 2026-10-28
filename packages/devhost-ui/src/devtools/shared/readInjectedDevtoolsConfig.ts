import {
  defaultDevtoolsComponentEditor,
  readDevtoolsComponentEditorValue,
  type DevtoolsComponentEditor,
  type DevtoolsPosition,
} from "./devtoolsConfig";
import {
  DEFAULT_RESTART_SERVICES_SHORTCUT,
  DEVHOST_SERVICE_NAME,
  DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME,
} from "./constants";
import { normalizeRoutedServicePath, type IRoutedServiceIdentity } from "./routedServices";

export interface IInjectedDevtoolsConfig {
  componentEditor: DevtoolsComponentEditor;
  homeDirectoryPath: string;
  position: DevtoolsPosition;
  projectRootPath: string;
  /** The devhost checkout chat can target instead of the project, or "" when devhost serves no source checkout. */
  devhostSourceRootPath: string;
  routedServices: IRoutedServiceIdentity[];
  stackName: string;
  annotationEnabled: boolean;
  chatEnabled: boolean;
  configEditorEnabled: boolean;
  editorEnabled: boolean;
  externalToolbarsEnabled: boolean;
  minimapEnabled: boolean;
  resourcesEnabled: boolean;
  statusEnabled: boolean;
  restartServicesShortcut?: string;
  primaryService?: string;
}

const defaultInjectedDevtoolsConfig: IInjectedDevtoolsConfig = {
  componentEditor: defaultDevtoolsComponentEditor,
  homeDirectoryPath: "",
  position: "bottom-right",
  projectRootPath: "",
  devhostSourceRootPath: "",
  routedServices: [],
  stackName: DEVHOST_SERVICE_NAME,
  annotationEnabled: false,
  chatEnabled: false,
  configEditorEnabled: false,
  editorEnabled: true,
  externalToolbarsEnabled: true,
  minimapEnabled: true,
  resourcesEnabled: false,
  statusEnabled: true,
  restartServicesShortcut: DEFAULT_RESTART_SERVICES_SHORTCUT,
  primaryService: "",
};

// The injected object is replaced, never edited in place, so each one is parsed once. Components read the
// configuration during render and get the same object and arrays until the configuration changes.
const parsedConfigs = new WeakMap<object, IInjectedDevtoolsConfig>();

export function readInjectedDevtoolsConfig(): IInjectedDevtoolsConfig {
  const injectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

  if (typeof injectedConfig !== "object" || injectedConfig === null) {
    return defaultInjectedDevtoolsConfig;
  }

  const cachedConfig: IInjectedDevtoolsConfig | undefined = parsedConfigs.get(injectedConfig);

  if (cachedConfig !== undefined) {
    return cachedConfig;
  }

  const parsedConfig: IInjectedDevtoolsConfig = parseInjectedDevtoolsConfig(injectedConfig);

  parsedConfigs.set(injectedConfig, parsedConfig);

  return parsedConfig;
}

function parseInjectedDevtoolsConfig(injectedConfig: object): IInjectedDevtoolsConfig {
  const componentEditor: DevtoolsComponentEditor = readComponentEditorValue(injectedConfig);
  const homeDirectoryPath: unknown = Reflect.get(injectedConfig, "homeDirectoryPath");
  const devhostSourceRootPath: unknown = Reflect.get(injectedConfig, "devhostSourceRootPath");
  const position: DevtoolsPosition = readDevtoolsPositionValue(injectedConfig);
  const projectRootPath: string = readProjectRootPathValue(injectedConfig);
  const routedServices: IRoutedServiceIdentity[] = readRoutedServicesValue(injectedConfig);
  const stackName: string = readStackNameValue(injectedConfig);
  const chatEnabled: boolean = readBooleanValue(injectedConfig, "chatEnabled", false);
  const annotationEnabled: boolean = readBooleanValue(injectedConfig, "annotationEnabled", false);
  const configEditorEnabled: boolean = readBooleanValue(injectedConfig, "configEditorEnabled", false);
  const editorEnabled: boolean = readBooleanValue(injectedConfig, "editorEnabled", true);
  const externalToolbarsEnabled: boolean = readBooleanValue(injectedConfig, "externalToolbarsEnabled", true);
  const minimapEnabled: boolean = readBooleanValue(injectedConfig, "minimapEnabled", true);
  const resourcesEnabled: boolean = readBooleanValue(
    injectedConfig,
    "resourcesEnabled",
    defaultInjectedDevtoolsConfig.resourcesEnabled,
  );
  const statusEnabled: boolean = readBooleanValue(injectedConfig, "statusEnabled", true);
  const restartServicesShortcut: string = readRestartServicesShortcutValue(injectedConfig);
  const primaryService: string = readPrimaryServiceValue(injectedConfig);

  return {
    annotationEnabled,
    chatEnabled,
    componentEditor,
    configEditorEnabled,
    homeDirectoryPath: typeof homeDirectoryPath === "string" ? homeDirectoryPath : "",
    position,
    projectRootPath,
    devhostSourceRootPath: typeof devhostSourceRootPath === "string" ? devhostSourceRootPath : "",
    routedServices,
    stackName,
    editorEnabled,
    externalToolbarsEnabled,
    minimapEnabled,
    resourcesEnabled,
    statusEnabled,
    restartServicesShortcut,
    primaryService,
  };
}

function readComponentEditorValue(injectedConfig: object): DevtoolsComponentEditor {
  const componentEditor: unknown = Reflect.get(injectedConfig, "componentEditor");

  return readDevtoolsComponentEditorValue(componentEditor);
}

function readDevtoolsPositionValue(injectedConfig: object): DevtoolsPosition {
  const position: unknown = Reflect.get(injectedConfig, "position");

  if (position === "top-right") {
    return "top-right";
  }

  if (position === "bottom-right") {
    return "bottom-right";
  }

  return defaultInjectedDevtoolsConfig.position;
}

function readProjectRootPathValue(injectedConfig: object): string {
  const projectRootPath: unknown = Reflect.get(injectedConfig, "projectRootPath");

  return typeof projectRootPath === "string" ? projectRootPath : defaultInjectedDevtoolsConfig.projectRootPath;
}

function readRoutedServicesValue(injectedConfig: object): IRoutedServiceIdentity[] {
  const routedServices: unknown = Reflect.get(injectedConfig, "routedServices");

  if (!Array.isArray(routedServices)) {
    return defaultInjectedDevtoolsConfig.routedServices;
  }

  return routedServices.flatMap((service): IRoutedServiceIdentity[] => {
    if (typeof service !== "object" || service === null) {
      return [];
    }

    const host: unknown = Reflect.get(service, "host");
    const path: unknown = Reflect.get(service, "path");
    const serviceName: unknown = Reflect.get(service, "serviceName");

    if (typeof host !== "string" || typeof path !== "string" || typeof serviceName !== "string") {
      return [];
    }

    return [
      {
        host,
        path: normalizeRoutedServicePath(path),
        serviceName,
      },
    ];
  });
}

function readStackNameValue(injectedConfig: object): string {
  const stackName: unknown = Reflect.get(injectedConfig, "stackName");

  return typeof stackName === "string" && stackName.length > 0 ? stackName : defaultInjectedDevtoolsConfig.stackName;
}

function readBooleanValue(injectedConfig: object, key: string, defaultValue: boolean): boolean {
  const value = Reflect.get(injectedConfig, key);
  return typeof value === "boolean" ? value : defaultValue;
}

function readRestartServicesShortcutValue(injectedConfig: object): string {
  const restartServicesShortcut: unknown = Reflect.get(injectedConfig, "restartServicesShortcut");

  return typeof restartServicesShortcut === "string" && restartServicesShortcut.length > 0
    ? restartServicesShortcut
    : DEFAULT_RESTART_SERVICES_SHORTCUT;
}

function readPrimaryServiceValue(injectedConfig: object): string {
  const primaryService: unknown = Reflect.get(injectedConfig, "primaryService");

  return typeof primaryService === "string" && primaryService.length > 0 ? primaryService : "";
}
