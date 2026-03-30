import { buildDevtoolsScript } from "./buildDevtoolsScript";
import { INJECTED_SCRIPT_PATH, TIME_API_PATH } from "./devtools/constants";

type IStartInjectionProxyOptions = {
  backendHost: string;
  backendPort: number;
};

type IInjectionProxy = {
  port: number;
  stop: () => Promise<void>;
};

export async function startInjectionProxy(options: IStartInjectionProxyOptions): Promise<IInjectionProxy> {
  const devtoolsScript: string = await buildDevtoolsScript();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request: Request): Promise<Response> => {
      const requestUrl: URL = new URL(request.url);

      if (requestUrl.pathname === INJECTED_SCRIPT_PATH) {
        return new Response(devtoolsScript, {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      if (requestUrl.pathname === TIME_API_PATH) {
        return new Response(
          JSON.stringify(
            {
              currentTime: new Date().toISOString(),
            },
            null,
            2,
          ),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            },
          },
        );
      }

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
        status: transformedResponse.status,
        statusText: transformedResponse.statusText,
        headers: responseHeaders,
      });
    },
  });

  return {
    port: server.port,
    stop: async (): Promise<void> => {
      await server.stop(true);
    },
  };
}

function createUpstreamRequest(request: Request, options: IStartInjectionProxyOptions): Request {
  const requestUrl: URL = new URL(request.url);
  const upstreamUrl: URL = new URL(requestUrl.toString());
  const upstreamHeaders: Headers = new Headers(request.headers);
  const requestMethod: string = request.method.toUpperCase();

  upstreamUrl.protocol = "http:";
  upstreamUrl.hostname = options.backendHost;
  upstreamUrl.port = String(options.backendPort);

  upstreamHeaders.delete("host");
  upstreamHeaders.set("x-forwarded-host", requestUrl.host);
  upstreamHeaders.set("x-forwarded-proto", "https");
  upstreamHeaders.set("x-devhost-injected", "true");

  if (!canRequestHaveBody(requestMethod)) {
    return new Request(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      redirect: "manual",
    });
  }

  return new Request(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: request.body,
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
