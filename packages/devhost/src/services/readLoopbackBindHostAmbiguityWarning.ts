import type { IResolvedDevhostService } from "../types/stackTypes";
import { formatProxyAddress, resolveProxyHost } from "../utils/resolveProxyHost";

interface IHttpResponseProbe {
  location: string | null;
  status: number;
}

interface IReadLoopbackBindHostAmbiguityWarningOptions {
  fetchImpl?: typeof fetch;
  service: IResolvedDevhostService;
}

const probeTimeoutInMilliseconds: number = 750;

export async function readLoopbackBindHostAmbiguityWarning({
  fetchImpl = fetch,
  service,
}: IReadLoopbackBindHostAmbiguityWarningOptions): Promise<string | null> {
  if (service.host === null || service.port === null) {
    return null;
  }

  const proxyHost: string = resolveProxyHost(service.bindHost);
  const preferredBindHost: string | null = readAlternativeBindHost(service.bindHost);

  if (preferredBindHost === null) {
    return null;
  }

  const localhostProbe = await probeHttpResponse(fetchImpl, "localhost", service.port);
  const routedProbe = await probeHttpResponse(fetchImpl, proxyHost, service.port);

  if (localhostProbe === null || routedProbe === null || areResponseProbesEqual(localhostProbe, routedProbe)) {
    return null;
  }

  const preferredProbe = await probeHttpResponse(fetchImpl, resolveProxyHost(preferredBindHost), service.port);
  const recommendation =
    preferredProbe !== null && areResponseProbesEqual(localhostProbe, preferredProbe)
      ? ` Consider setting services.${service.name}.bindHost = ${JSON.stringify(preferredBindHost)}.`
      : " Set services.<name>.bindHost explicitly to match the listener your app prints.";

  return (
    `services.${service.name}.port = ${service.port} is ambiguous: ` +
    `http://localhost:${service.port}/ responded differently than ` +
    `http://${formatProxyAddress(proxyHost, service.port)}/. ` +
    `devhost routes https://${service.host} through ${service.bindHost}:${service.port}, ` +
    `so a localhost URL may hit a different loopback listener on this machine.` +
    recommendation
  );
}

async function probeHttpResponse(
  fetchImpl: typeof fetch,
  host: string,
  port: number,
): Promise<IHttpResponseProbe | null> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, probeTimeoutInMilliseconds);

  try {
    const response = await fetchImpl(createProbeUrl(host, port), {
      redirect: "manual",
      signal: abortController.signal,
    });

    return {
      location: response.headers.get("location"),
      status: response.status,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function areResponseProbesEqual(left: IHttpResponseProbe, right: IHttpResponseProbe): boolean {
  return left.location === right.location && left.status === right.status;
}

function createProbeUrl(host: string, port: number): string {
  return `http://${formatProxyAddress(host, port)}/`;
}

function readAlternativeBindHost(bindHost: string): string | null {
  if (bindHost === "127.0.0.1" || bindHost === "0.0.0.0") {
    return "::1";
  }

  if (bindHost === "::1" || bindHost === "::") {
    return "127.0.0.1";
  }

  return null;
}
