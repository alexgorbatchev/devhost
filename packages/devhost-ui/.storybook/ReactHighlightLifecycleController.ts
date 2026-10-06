import type {
  IOverlayElement,
  IReactHighlightCursorMessage,
} from "../src/devtools/features/reactHighlight/reactHighlightOverlay";

interface IHighlightRequest {
  locator: string;
  projectRootPath: string;
  overlayRoot: HTMLElement;
  result: PromiseWithResolvers<IOverlayElement[]>;
  isResolved: boolean;
}

class CursorSocket extends EventTarget {
  closeCount: number = 0;
  readonly url: string;
  private readonly onClose: () => void;

  constructor(url: string, onClose: () => void) {
    super();
    this.url = url;
    this.onClose = onClose;
  }

  close(): void {
    this.closeCount += 1;
    this.onClose();
  }

  deliver(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

export class ReactHighlightLifecycleController extends EventTarget {
  readonly sockets: CursorSocket[] = [];
  readonly requests: IHighlightRequest[] = [];
  private version: number = 0;
  private readonly isDeferred: boolean;

  constructor(isDeferred: boolean) {
    super();
    this.isDeferred = isDeferred;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.addEventListener("change", listener);
    return () => this.removeEventListener("change", listener);
  };

  readonly getSnapshot = (): number => this.version;

  readonly createWebSocket = (url: string): Pick<WebSocket, "addEventListener" | "removeEventListener" | "close"> => {
    const socket = new CursorSocket(url, () => this.notify());
    this.sockets.push(socket);
    this.notify();
    return socket;
  };

  readonly highlightElements = (
    locator: string,
    projectRootPath: string,
    overlayRoot: HTMLElement,
  ): Promise<IOverlayElement[]> => {
    const result = Promise.withResolvers<IOverlayElement[]>();
    const request: IHighlightRequest = { locator, projectRootPath, overlayRoot, result, isResolved: false };
    this.requests.push(request);
    if (!this.isDeferred) {
      this.completeRequest(request);
    }
    this.notify();
    return result.promise;
  };

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
    const socket = this.sockets.at(-1);
    [new ArrayBuffer(1), "{", "{}", '{"kind":"other"}', '{"kind":"cursor","locator":42}'].forEach((data) =>
      socket?.deliver(data),
    );
  }

  resolveRequest(index: number): void {
    const request = this.requests[index];
    if (request === undefined || request.isResolved) {
      throw new Error("The selected highlight request is not pending.");
    }
    this.completeRequest(request);
    this.notify();
  }

  private completeRequest(request: IHighlightRequest): void {
    const overlay = request.overlayRoot.ownerDocument.createElement("div");
    overlay.setAttribute("data-testid", "ReactHighlightLifecycleScene--overlay");
    overlay.textContent = request.locator;
    request.overlayRoot.append(overlay);
    request.isResolved = true;
    request.result.resolve([{ overlay }]);
  }

  private notify(): void {
    this.version += 1;
    this.dispatchEvent(new Event("change"));
  }
}
