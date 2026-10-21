import type { ISourceLocation } from "../../shared/sourceLocation";

export interface IComponentSourceProperty {
  name: string;
  title?: string;
}

export interface IComponentSourceMenuItem {
  displayName: string;
  key: string;
  props: IComponentSourceProperty[];
  source: ISourceLocation;
  sourceLabel: string;
  action: {
    kind: "external-editor";
    sourceUrl: string;
  };
}

export interface IComponentSourceMenuState {
  errorMessage?: string;
  items: IComponentSourceMenuItem[];
  title: string;
  x: number;
  y: number;
}

export interface ISetComponentMenuFunction {
  (menu: IComponentSourceMenuState | null): void;
}
