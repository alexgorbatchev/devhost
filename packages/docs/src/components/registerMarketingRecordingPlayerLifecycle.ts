interface IRecordingPlayerLifecycle {
  addEventListener(event: string, handler: () => void): void;
  play(): void;
}

interface IRegisterMarketingRecordingPlayerLifecycleOptions {
  player: IRecordingPlayerLifecycle;
  scheduleResponsivePlayerLayout: () => void;
}

export function registerMarketingRecordingPlayerLifecycle(
  options: IRegisterMarketingRecordingPlayerLifecycleOptions,
): void {
  options.player.addEventListener("finish", (): void => {
    options.player.play();
    options.scheduleResponsivePlayerLayout();
  });

  options.player.addEventListener("resize", (): void => {
    options.scheduleResponsivePlayerLayout();
  });
}
