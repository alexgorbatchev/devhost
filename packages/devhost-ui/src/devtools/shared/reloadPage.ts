let isOwnReloadPending = false;

/** Reloads the page on devhost's own account, which the reload hold lets through. */
export function reloadPage(): void {
  isOwnReloadPending = true;
  window.location.reload();
}

export function readIsOwnReloadPending(): boolean {
  return isOwnReloadPending;
}
