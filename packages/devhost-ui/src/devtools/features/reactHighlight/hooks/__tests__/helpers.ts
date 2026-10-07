import type { IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";
import type { IOverlayElement, IReactHighlightCursorMessage } from "../../reactHighlightOverlay";

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

/** The highlight renderer `useReactHighlightOverlay` accepts, recording every request it receives. */
export class HighlightRenderer {
  private readonly requests: IHighlightRequest[] = [];
  private readonly isDeferred: boolean;

  /** A deferred renderer answers a request only when the test calls `resolveRequest`. */
  constructor(isDeferred: boolean = false) {
    this.isDeferred = isDeferred;
  }

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

  get requestSummaries(): IHighlightRequestSummary[] {
    return this.requests.map(({ locator, projectRootPath }: IHighlightRequest): IHighlightRequestSummary => {
      return { locator, projectRootPath };
    });
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

/** Sends the cursor position an editor reports. An empty `projectRoot` leaves the project to the page's own. */
export function sendCursor(
  connection: IMockWebSocketConnection,
  locator: string | null,
  projectRoot: string = "/message-project",
): void {
  const payload: IReactHighlightCursorMessage = {
    kind: "cursor",
    locator,
    projectRoot,
    stackName: "cursor-lifecycle",
    timestamp: 1,
  };

  connection.send(payload);
}

export function sendInvalidMessages(connection: IMockWebSocketConnection): void {
  connection.sendFrame(new ArrayBuffer(1));
  connection.sendFrame("{");
  connection.send({});
  connection.send({ kind: "other" });
  connection.send({ kind: "cursor", locator: 42 });
}

export function createOverlayRoot(): HTMLDivElement {
  const overlayRoot: HTMLDivElement = document.createElement("div");

  document.body.append(overlayRoot);

  return overlayRoot;
}

export function readOverlayLocators(overlayRoot: HTMLElement): string[] {
  return Array.from(overlayRoot.children, (overlay: Element): string => overlay.textContent ?? "");
}
