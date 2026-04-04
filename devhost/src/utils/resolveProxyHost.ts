export function resolveProxyHost(bindHost: string): string {
  if (bindHost === "127.0.0.1" || bindHost === "0.0.0.0") {
    return "127.0.0.1";
  }

  if (bindHost === "::1" || bindHost === "::") {
    return "::1";
  }

  throw new Error(`Unsupported bind host: ${bindHost}`);
}

export function formatProxyAddress(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}
