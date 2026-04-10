export interface IExternalDevtoolsLauncher {
  id: string;
  label: string;
  title: string;
}

export interface IDetectedExternalDevtoolsLauncher {
  hiddenElements: HTMLElement[];
  launcherElement: HTMLElement;
}

export interface IExternalDevtoolsDetector {
  detect: () => IDetectedExternalDevtoolsLauncher | null;
  id: string;
  label: string;
  title: string;
}
