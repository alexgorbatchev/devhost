import {
  defaultAnnotationActionId,
  defaultDevhostAgentDisplayName,
  defaultDevtoolsComponentEditor,
  readDevtoolsComponentEditorValue,
  type AnnotationActionKind,
  type DevtoolsComponentEditor,
  type DevtoolsPosition,
  type IAnnotationAction,
} from "./devtoolsConfig";
import { DEVHOST_SERVICE_NAME, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "./constants";
import { normalizeRoutedServicePath, type IRoutedServiceIdentity } from "./routedServices";

export interface IInjectedDevtoolsConfig {
  agentDisplayName: string;
  annotationActions: IAnnotationAction[];
  annotationDefaultActionId: string;
  componentEditor: DevtoolsComponentEditor;
  controlToken: string;
  position: DevtoolsPosition;
  projectRootPath: string;
  routedServices: IRoutedServiceIdentity[];
  stackName: string;
  annotationEnabled: boolean;
  annotationQueueEnabled: boolean;
  editorEnabled: boolean;
  externalToolbarsEnabled: boolean;
  minimapEnabled: boolean;
  statusEnabled: boolean;
  terminalEnabled: boolean;
}

const defaultInjectedDevtoolsConfig: IInjectedDevtoolsConfig = {
  agentDisplayName: defaultDevhostAgentDisplayName,
  annotationActions: [
    {
      displayName: defaultDevhostAgentDisplayName,
      id: defaultAnnotationActionId,
      kind: "agent",
      queueEnabled: true,
    },
  ],
  annotationDefaultActionId: defaultAnnotationActionId,
  componentEditor: defaultDevtoolsComponentEditor,
  controlToken: "",
  position: "bottom-right",
  projectRootPath: "",
  routedServices: [],
  stackName: DEVHOST_SERVICE_NAME,
  annotationEnabled: true,
  annotationQueueEnabled: true,
  editorEnabled: true,
  externalToolbarsEnabled: true,
  minimapEnabled: true,
  statusEnabled: true,
  terminalEnabled: true,
};

export function readInjectedDevtoolsConfig(): IInjectedDevtoolsConfig {
  const injectedConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);

  if (typeof injectedConfig !== "object" || injectedConfig === null) {
    return defaultInjectedDevtoolsConfig;
  }

  const agentDisplayName: string = readAgentDisplayNameValue(injectedConfig);
  const annotationActions: IAnnotationAction[] = readAnnotationActionsValue(injectedConfig, agentDisplayName);
  const annotationDefaultActionId: string = readAnnotationDefaultActionIdValue(injectedConfig, annotationActions);
  const componentEditor: DevtoolsComponentEditor = readComponentEditorValue(injectedConfig);
  const controlToken: string = readControlTokenValue(injectedConfig);
  const position: DevtoolsPosition = readDevtoolsPositionValue(injectedConfig);
  const projectRootPath: string = readProjectRootPathValue(injectedConfig);
  const routedServices: IRoutedServiceIdentity[] = readRoutedServicesValue(injectedConfig);
  const stackName: string = readStackNameValue(injectedConfig);
  const annotationEnabled: boolean = readBooleanValue(injectedConfig, "annotationEnabled", true);
  const annotationQueueEnabled: boolean = readBooleanValue(injectedConfig, "annotationQueueEnabled", true);
  const editorEnabled: boolean = readBooleanValue(injectedConfig, "editorEnabled", true);
  const externalToolbarsEnabled: boolean = readBooleanValue(injectedConfig, "externalToolbarsEnabled", true);
  const minimapEnabled: boolean = readBooleanValue(injectedConfig, "minimapEnabled", true);
  const statusEnabled: boolean = readBooleanValue(injectedConfig, "statusEnabled", true);
  const terminalEnabled: boolean = readBooleanValue(injectedConfig, "terminalEnabled", true);

  return {
    agentDisplayName,
    annotationActions,
    annotationEnabled,
    annotationDefaultActionId,
    annotationQueueEnabled,
    componentEditor,
    controlToken,
    position,
    projectRootPath,
    routedServices,
    stackName,
    editorEnabled,
    externalToolbarsEnabled,
    minimapEnabled,
    statusEnabled,
    terminalEnabled,
  };
}

function readAnnotationActionsValue(injectedConfig: object, agentDisplayName: string): IAnnotationAction[] {
  const annotationActions: unknown = Reflect.get(injectedConfig, "annotationActions");

  if (!Array.isArray(annotationActions)) {
    return createLegacyAnnotationActions(agentDisplayName);
  }

  const uniqueActionIds = new Set<string>();
  const parsedActions: IAnnotationAction[] = annotationActions.flatMap((action: unknown): IAnnotationAction[] => {
    if (typeof action !== "object" || action === null) {
      return [];
    }

    const id: unknown = Reflect.get(action, "id");
    const displayName: unknown = Reflect.get(action, "displayName");
    const kind: unknown = Reflect.get(action, "kind");
    const queueEnabled: unknown = Reflect.get(action, "queueEnabled");

    if (
      typeof id !== "string" ||
      id.length === 0 ||
      uniqueActionIds.has(id) ||
      typeof displayName !== "string" ||
      displayName.trim().length === 0 ||
      !isAnnotationActionKind(kind) ||
      typeof queueEnabled !== "boolean"
    ) {
      return [];
    }

    uniqueActionIds.add(id);

    return [
      {
        displayName,
        id,
        kind,
        queueEnabled,
      },
    ];
  });

  return parsedActions.length > 0 ? parsedActions : createLegacyAnnotationActions(agentDisplayName);
}

function readAnnotationDefaultActionIdValue(injectedConfig: object, annotationActions: IAnnotationAction[]): string {
  const annotationDefaultActionId: unknown = Reflect.get(injectedConfig, "annotationDefaultActionId");

  if (
    typeof annotationDefaultActionId === "string" &&
    annotationActions.some((action: IAnnotationAction): boolean => action.id === annotationDefaultActionId)
  ) {
    return annotationDefaultActionId;
  }

  return annotationActions[0]?.id ?? defaultInjectedDevtoolsConfig.annotationDefaultActionId;
}

function createLegacyAnnotationActions(agentDisplayName: string): IAnnotationAction[] {
  return [
    {
      displayName: agentDisplayName,
      id: defaultAnnotationActionId,
      kind: "agent",
      queueEnabled: true,
    },
  ];
}

function isAnnotationActionKind(value: unknown): value is AnnotationActionKind {
  return value === "agent" || value === "command";
}

function readAgentDisplayNameValue(injectedConfig: object): string {
  const agentDisplayName: unknown = Reflect.get(injectedConfig, "agentDisplayName");

  return typeof agentDisplayName === "string" && agentDisplayName.trim().length > 0
    ? agentDisplayName
    : defaultInjectedDevtoolsConfig.agentDisplayName;
}

function readComponentEditorValue(injectedConfig: object): DevtoolsComponentEditor {
  const componentEditor: unknown = Reflect.get(injectedConfig, "componentEditor");

  return readDevtoolsComponentEditorValue(componentEditor);
}

function readControlTokenValue(injectedConfig: object): string {
  const controlToken: unknown = Reflect.get(injectedConfig, "controlToken");

  return typeof controlToken === "string" ? controlToken : defaultInjectedDevtoolsConfig.controlToken;
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
