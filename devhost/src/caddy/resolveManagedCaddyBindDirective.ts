export function resolveManagedCaddyBindDirective(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "darwin") {
    return null;
  }

  return "    default_bind 127.0.0.1 [::1]";
}
