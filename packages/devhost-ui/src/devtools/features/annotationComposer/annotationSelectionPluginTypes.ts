import type { IAnnotationMarkerPayload, IRectSnapshot } from "./types";

export type AnnotationSelectionIntent = "hover" | "select";

export type AnnotationSelectionPluginListener = () => void;

export type AnnotationSelectionPluginSubscription = () => void;

export interface IAnnotationSelectionCandidate {
  buildMarkerPayload: (markerNumber: number) => Promise<IAnnotationMarkerPayload>;
  id: string;
  label: string;
  readRect: () => IRectSnapshot | null;
}

export interface IAnnotationSelectionPluginContext {
  isDevtoolsEventTarget: (target: EventTarget | null) => boolean;
}

export interface IAnnotationSelectionPlugin {
  getCursorStyleText?: () => string | null;
  id: string;
  label: string;
  matches?: () => boolean;
  priority?: number;
  resolveCandidate: (
    event: MouseEvent,
    intent: AnnotationSelectionIntent,
    context: IAnnotationSelectionPluginContext,
  ) => IAnnotationSelectionCandidate | Promise<IAnnotationSelectionCandidate | null> | null;
}

export interface IAnnotationSelectionPluginRegistry {
  listPlugins: () => IAnnotationSelectionPlugin[];
  registerPlugin: (plugin: IAnnotationSelectionPlugin) => AnnotationSelectionPluginSubscription;
  subscribe: (listener: AnnotationSelectionPluginListener) => AnnotationSelectionPluginSubscription;
  unregisterPlugin: (pluginId: string) => void;
}
