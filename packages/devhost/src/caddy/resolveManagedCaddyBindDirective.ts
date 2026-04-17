export const defaultManagedCaddyBindHost: string = "127.0.0.1";

export function resolveManagedCaddyBindDirective(
  platform: NodeJS.Platform = process.platform,
  bindHost: string = defaultManagedCaddyBindHost,
): string | null {
  if (platform === "darwin" && bindHost === defaultManagedCaddyBindHost) {
    return null;
  }

  switch (bindHost) {
    case "127.0.0.1": {
      return "    default_bind 127.0.0.1 [::1]";
    }
    case "0.0.0.0": {
      return "    default_bind 0.0.0.0 [::]";
    }
    case "::1": {
      return "    default_bind [::1]";
    }
    case "::": {
      return "    default_bind [::]";
    }
    default: {
      throw new Error(`Unsupported managed Caddy bind host: ${bindHost}`);
    }
  }
}
