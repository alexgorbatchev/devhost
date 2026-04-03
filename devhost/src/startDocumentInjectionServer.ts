import { INJECTED_SCRIPT_PATH } from "./devtools/shared/constants";

interface IStartDocumentInjectionServerOptions {
  backendHost: string;
  backendPort: number;
}

interface IDocumentInjectionServer {
  port: number;
  stop: () => Promise<void>;
}

export function startDocumentInjectionServer(options: IStartDocumentInjectionServerOptions): IDocumentInjectionServer {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request: Request): Promise<Response> => {
      const upstreamRequest: Request = createUpstreamRequest(request, options);
      const upstreamResponse: Response = await fetch(upstreamRequest);

      if (!isHtmlResponse(upstreamResponse)) {
        return upstreamResponse;
      }

      const transformedResponse: Response = new HTMLRewriter()
        .on("body", {
          element: (element): void => {
            element.append(`<script type="module" src="${INJECTED_SCRIPT_PATH}"></script>`, { html: true });
          },
        })
        .transform(upstreamResponse);
      const responseHeaders: Headers = new Headers(transformedResponse.headers);

      responseHeaders.delete("content-security-policy");
      responseHeaders.delete("content-security-policy-report-only");
      responseHeaders.delete("content-length");

      return new Response(transformedResponse.body, {
        headers: responseHeaders,
        status: transformedResponse.status,
        statusText: transformedResponse.statusText,
      });
    },
  });

  const serverPort: number | undefined = server.port;

  if (serverPort === undefined) {
    throw new Error("Failed to start document injection server: no port was assigned.");
  }

  return {
    port: serverPort,
    stop: async (): Promise<void> => {
      await server.stop(true);
    },
  };
}

function createUpstreamRequest(request: Request, options: IStartDocumentInjectionServerOptions): Request {
  const requestUrl: URL = new URL(request.url);
  const upstreamUrl: URL = new URL(requestUrl.toString());
  const upstreamHeaders: Headers = new Headers(request.headers);
  const requestMethod: string = request.method.toUpperCase();

  upstreamUrl.protocol = "http:";
  upstreamUrl.hostname = options.backendHost;
  upstreamUrl.port = String(options.backendPort);

  upstreamHeaders.delete("host");
  upstreamHeaders.set("x-devhost-injected", "true");
  upstreamHeaders.set("x-forwarded-host", requestUrl.host);
  upstreamHeaders.set("x-forwarded-proto", "https");

  if (!canRequestHaveBody(requestMethod)) {
    return new Request(upstreamUrl, {
      headers: upstreamHeaders,
      method: request.method,
      redirect: "manual",
    });
  }

  return new Request(upstreamUrl, {
    body: request.body,
    headers: upstreamHeaders,
    method: request.method,
    redirect: "manual",
  });
}

function canRequestHaveBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function isHtmlResponse(response: Response): boolean {
  const contentType: string = response.headers.get("content-type") ?? "";

  return contentType.includes("text/html");
}
