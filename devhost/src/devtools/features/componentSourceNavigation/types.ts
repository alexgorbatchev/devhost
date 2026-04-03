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
  sourceUrl: string;
}

export interface IComponentSourceMenuState {
  items: IComponentSourceMenuItem[];
  x: number;
  y: number;
}
