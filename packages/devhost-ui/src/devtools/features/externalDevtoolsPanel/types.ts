export interface IExternalDevtoolsLauncher {
  id: string;
  isOpen: boolean;
  label: string;
  title: string;
}

export interface IExternalDevtoolsAdapter {
  close: () => void;
  hideSelectors: string[];
  id: string;
  isInstalled: () => boolean;
  isOpen: () => boolean;
  label: string;
  open: () => void;
  title: string;
}
