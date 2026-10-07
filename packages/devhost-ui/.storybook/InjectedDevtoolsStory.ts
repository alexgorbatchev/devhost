import { renderDevtools, type UnmountDevtools } from "../src/devtools/renderDevtools";

export class InjectedDevtoolsStory {
  private unmountDevtools: UnmountDevtools | undefined;

  mount(): void {
    this.unmountDevtools ??= renderDevtools();
  }

  unmount = (): void => {
    this.unmountDevtools?.();
    this.unmountDevtools = undefined;
  };
}
