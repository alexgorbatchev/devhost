import type { ISourceLocation } from "../../shared/sourceLocation";

export interface IComponentSourceProperty {
  name: string;
  title?: string;
}

interface IComponentSourceMenuItemBase {
  displayName: string;
  key: string;
  props: IComponentSourceProperty[];
  source: ISourceLocation;
  sourceLabel: string;
}

export interface IExternalEditorComponentSourceMenuItem extends IComponentSourceMenuItemBase {
  action: {
    kind: "external-editor";
    sourceUrl: string;
  };
}

export interface INeovimComponentSourceMenuItem extends IComponentSourceMenuItemBase {
  action: {
    kind: "neovim";
  };
}

export type ComponentSourceMenuItem = IExternalEditorComponentSourceMenuItem | INeovimComponentSourceMenuItem;

export interface IComponentSourceMenuState {
  errorMessage?: string;
  items: ComponentSourceMenuItem[];
  title: string;
  x: number;
  y: number;
}

export interface ISetComponentMenuFunction {
  (menu: IComponentSourceMenuState | null): void;
}
