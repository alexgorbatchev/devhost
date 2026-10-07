import { GlobalRegistrator } from "@happy-dom/global-registrator";

import type { IOverlayElement, IReactHighlightCursorMessage } from "../../reactHighlightOverlay";

// React DOM and Testing Library read the DOM globals while they load, so this module registers them when it is
// evaluated. Test files import it before either of those.
GlobalRegistrator.register({ url: "http://app.localhost/" });

type CursorSocketConnection = Pick<WebSocket, "addEventListener" | "removeEventListener" | "close">;

interface IHighlightRequest {
  isResolved: boolean;
  locator: string;
  overlayRoot: HTMLElement;
  projectRootPath: string;
  result: PromiseWithResolvers<IOverlayElement[]>;
}

export interface IHighlightRequestSummary {
  locator: string;
  projectRootPath: string;
}

class CursorSocket extends EventTarget {
  closeCount: number = 0;
  readonly url: string;

  constructor(url: string) {
    super();
    this.url = url;
  }

  close(): void {
    this.closeCount += 1;
  }

  deliver(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

/** The collaborators `useReactHighlightOverlay` accepts, recording every connection and highlight request. */
export class ReactHighlightLifecycleController {
  readonly sockets: CursorSocket[] = [];
  private readonly requests: IHighlightRequest[] = [];
  private readonly isDeferred: boolean;

  constructor(isDeferred: boolean = false) {
    this.isDeferred = isDeferred;
  }

  readonly createWebSocket = (url: string): CursorSocketConnection => {
    const socket = new CursorSocket(url);

    this.sockets.push(socket);

    return socket;
  };

  readonly highlightElements = (
    locator: string,
    projectRootPath: string,
    overlayRoot: HTMLElement,
  ): Promise<IOverlayElement[]> => {
    const request: IHighlightRequest = {
      isResolved: false,
      locator,
      overlayRoot,
      projectRootPath,
      result: Promise.withResolvers<IOverlayElement[]>(),
    };

    this.requests.push(request);
    if (!this.isDeferred) {
      this.completeRequest(request);
    }

    return request.result.promise;
  };

  get closedConnectionCount(): number {
    return this.sockets.reduce((count: number, socket: CursorSocket): number => count + socket.closeCount, 0);
  }

  get requestSummaries(): IHighlightRequestSummary[] {
    return this.requests.map(({ locator, projectRootPath }: IHighlightRequest): IHighlightRequestSummary => {
      return { locator, projectRootPath };
    });
  }

  /** Delivers a cursor message on the newest socket, or on `socketIndex` when given. */
  sendCursor(
    locator: string | null,
    projectRoot: string = "/message-project",
    socketIndex: number = this.sockets.length - 1,
  ): void {
    const payload: IReactHighlightCursorMessage = {
      kind: "cursor",
      locator,
      projectRoot,
      stackName: "cursor-lifecycle",
      timestamp: 1,
    };

    this.sockets[socketIndex]?.deliver(JSON.stringify(payload));
  }

  sendInvalidMessages(): void {
    const socket: CursorSocket | undefined = this.sockets.at(-1);

    for (const data of [new ArrayBuffer(1), "{", "{}", '{"kind":"other"}', '{"kind":"cursor","locator":42}']) {
      socket?.deliver(data);
    }
  }

  /** Resolves a deferred highlight request, appending its overlay to the overlay root as the renderer does. */
  resolveRequest(index: number): void {
    const request: IHighlightRequest | undefined = this.requests[index];

    if (request === undefined || request.isResolved) {
      throw new Error("The selected highlight request is not pending.");
    }

    this.completeRequest(request);
  }

  private completeRequest(request: IHighlightRequest): void {
    const overlay: HTMLDivElement = request.overlayRoot.ownerDocument.createElement("div");

    overlay.textContent = request.locator;
    request.overlayRoot.append(overlay);
    request.isResolved = true;
    request.result.resolve([{ overlay }]);
  }
}

export function createOverlayRoot(): HTMLDivElement {
  const overlayRoot: HTMLDivElement = document.createElement("div");

  document.body.append(overlayRoot);

  return overlayRoot;
}

export function readOverlayLocators(overlayRoot: HTMLElement): string[] {
  return Array.from(overlayRoot.children, (overlay: Element): string => overlay.textContent ?? "");
}

export async function unregisterDom(): Promise<void> {
  await GlobalRegistrator.unregister();
}
