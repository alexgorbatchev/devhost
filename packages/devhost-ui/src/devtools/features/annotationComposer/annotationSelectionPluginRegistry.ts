import type {
  AnnotationSelectionPluginListener,
  AnnotationSelectionPluginSubscription,
  IAnnotationSelectionPlugin,
  IAnnotationSelectionPluginRegistry,
} from "./annotationSelectionPluginTypes";
import { defaultDomAnnotationSelectionPlugin } from "./defaultDomAnnotationSelectionPlugin";

const annotationSelectionRegistryGlobalName: string = "__DEVHOST__";
const pendingAnnotationSelectionPluginsGlobalName: string = "__DEVHOST_PLUGINS__";
const annotationSelectionRegistryReadyEventName: string = "devhost:annotation-selection-ready";

const annotationSelectionPluginsById: Map<string, IAnnotationSelectionPlugin> = new Map();
const annotationSelectionListeners: Set<AnnotationSelectionPluginListener> = new Set();

declare global {
  interface WindowEventMap {
    "devhost:annotation-selection-ready": Event;
  }
}

initializeAnnotationSelectionRegistry();

export function registerAnnotationSelectionPlugin(
  plugin: IAnnotationSelectionPlugin,
): AnnotationSelectionPluginSubscription {
  annotationSelectionPluginsById.set(plugin.id, plugin);
  notifyAnnotationSelectionListeners();

  return (): void => {
    unregisterAnnotationSelectionPlugin(plugin.id);
  };
}

export function unregisterAnnotationSelectionPlugin(pluginId: string): void {
  if (!annotationSelectionPluginsById.delete(pluginId)) {
    return;
  }

  notifyAnnotationSelectionListeners();
}

export function listAnnotationSelectionPlugins(): IAnnotationSelectionPlugin[] {
  return [...annotationSelectionPluginsById.values()];
}

export function subscribeToAnnotationSelectionPlugins(
  listener: AnnotationSelectionPluginListener,
): AnnotationSelectionPluginSubscription {
  annotationSelectionListeners.add(listener);

  return (): void => {
    annotationSelectionListeners.delete(listener);
  };
}

export function readActiveAnnotationSelectionPlugin(): IAnnotationSelectionPlugin {
  const matchingPlugins: IAnnotationSelectionPlugin[] = listAnnotationSelectionPlugins().filter(
    (plugin: IAnnotationSelectionPlugin): boolean => {
      return plugin.matches?.() ?? true;
    },
  );

  if (matchingPlugins.length === 0) {
    return defaultDomAnnotationSelectionPlugin;
  }

  return matchingPlugins.reduce((selectedPlugin, plugin): IAnnotationSelectionPlugin => {
    return (plugin.priority ?? 0) > (selectedPlugin.priority ?? 0) ? plugin : selectedPlugin;
  });
}

function initializeAnnotationSelectionRegistry(): void {
  if (!annotationSelectionPluginsById.has(defaultDomAnnotationSelectionPlugin.id)) {
    annotationSelectionPluginsById.set(defaultDomAnnotationSelectionPlugin.id, defaultDomAnnotationSelectionPlugin);
  }

  const registry: IAnnotationSelectionPluginRegistry = {
    listPlugins: listAnnotationSelectionPlugins,
    registerPlugin: registerAnnotationSelectionPlugin,
    subscribe: subscribeToAnnotationSelectionPlugins,
    unregisterPlugin: unregisterAnnotationSelectionPlugin,
  };

  Reflect.set(globalThis, annotationSelectionRegistryGlobalName, registry);
  registerPendingAnnotationSelectionPlugins();

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(annotationSelectionRegistryReadyEventName));
  }
}

function registerPendingAnnotationSelectionPlugins(): void {
  const pendingPlugins: unknown = Reflect.get(globalThis, pendingAnnotationSelectionPluginsGlobalName);

  if (!Array.isArray(pendingPlugins)) {
    return;
  }

  for (const pendingPlugin of pendingPlugins) {
    if (isAnnotationSelectionPlugin(pendingPlugin)) {
      annotationSelectionPluginsById.set(pendingPlugin.id, pendingPlugin);
    }
  }

  pendingPlugins.length = 0;
  notifyAnnotationSelectionListeners();
}

function notifyAnnotationSelectionListeners(): void {
  for (const listener of annotationSelectionListeners) {
    listener();
  }
}

function isAnnotationSelectionPlugin(value: unknown): value is IAnnotationSelectionPlugin {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string";
}
