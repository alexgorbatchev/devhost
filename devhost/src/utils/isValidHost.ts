export function isValidHost(host: string): boolean {
  const hostPattern: RegExp = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

  return host === "localhost" || hostPattern.test(host);
}
