import type { IChatQuestionSelection } from "../../questions/types";
import { getChatQuestionAnswers } from "../../questions/getChatQuestionAnswers";
import { DevtoolsTopLayer } from "../../../../shared/components/DevtoolsTopLayer";
import { ToolbarPopover } from "../../../../shared/components/ToolbarPopover";
import { DevtoolsToolbar } from "../../../../shared/components/DevtoolsToolbar";
import { renderDevtoolsInStoryShadowRoot } from "../../../../shared/components/stories/helpers";
import { PageChat } from "../PageChat";
import { fixture_codexQuestion } from "../../questions/components/stories/fixtures";
import { DensityProvider, PortalProvider } from "@alexgorbatchev/shadcn";
import { useRef, useState, type JSX, type ReactElement } from "react";
import type { ChatRequestId, IChatEvent, IChatPendingRequest, IChatSession } from "../../types";
import { ApprovalRequests } from "../ApprovalRequests";
import { ChatApprovalRequest } from "../ChatApprovalRequest";
import { ChatQuestionRequest } from "../../questions/components/ChatQuestionRequest";
import { ChatQuestionField } from "../../questions/components/ChatQuestionField";
import { readChatApproval } from "../../readChatApproval";
import { readChatQuestions } from "../../readChatQuestions";
import type { FetchFunction } from "../../../../shared/pristineFetch";
import { useAgentChat } from "../../hooks/useAgentChat";
import { AgentChatPanel } from "../AgentChatPanel";
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from "@assistant-ui/react";
import { Thread } from "@alexgorbatchev/shadcn/assistant-ui/native/thread";
import { ChatUserText } from "../ChatUserText";
import { App } from "../../../../components/App";
import { DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME } from "../../../../shared/constants";
import { createMockWebSocket, type IMockWebSocketConnection } from "../../../../../../test-support/createMockWebSocket";
import { fixture_reloadEvents, fixture_reloadSession } from "./fixtures";
import { userEvent, within } from "storybook/test";
import type { IAnnotationPoint } from "../../../visualAnnotations/types";
import { cdp, userEvent as nativeUserEvent } from "vitest/browser";

/** Opens the saved session through the same controls as a user. */
export async function openSavedChatConversation(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Chat" }));
  await userEvent.click(canvas.getByRole("button", { name: "Chat Settings" }));
  await canvas.findByRole("option", { name: "codex · saved-conversation" });
  await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Conversation" }), "saved-conversation");
  await userEvent.keyboard("{Escape}");
  await canvas.findByText("codex · idle");
}

export function readChatViewport(panel: HTMLElement): HTMLDivElement {
  const viewport = panel.querySelector<HTMLDivElement>('[data-slot="aui_thread-viewport"]');
  if (!viewport) throw new Error("The native chat viewport has not mounted.");
  return viewport;
}

export function isChatViewportAtBottom(viewport: HTMLDivElement): boolean {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 1;
}

// The chat stream the reload server last accepted, so a story can deliver live events after the replay.
let liveChatConnection: IMockWebSocketConnection | null = null;

/** Delivers a completed agent reply, `Live reply <sequence>.`, to the saved conversation. */
export function deliverChatReply(sequence: number): void {
  if (!liveChatConnection) throw new Error("The chat stream is not connected.");
  liveChatConnection.send({
    type: "event",
    sessionId: fixture_reloadSession.id,
    sequence,
    payload: {
      method: "item/completed",
      params: { item: { type: "agentMessage", id: `live-${sequence}`, text: `Live reply ${sequence}.` } },
    },
  });
}

/** Reports a new status for the saved conversation, as the server does when a turn starts or ends. */
export function deliverChatStatus(status: IChatSession["status"]): void {
  if (!liveChatConnection) throw new Error("The chat stream is not connected.");
  liveChatConnection.send({
    type: "state",
    sessionId: fixture_reloadSession.id,
    session: { ...fixture_reloadSession, status },
    pendingRequestIds: [],
  });
}

/** The commands the client has sent over the chat stream, oldest first. */
export function readSentChatCommands(): unknown[] {
  if (!liveChatConnection) throw new Error("The chat stream is not connected.");
  return liveChatConnection.readSentFrames().map((frame) => JSON.parse(String(frame)));
}

/** The injected app inside a devtools shadow root, as `renderDevtools` mounts it on a page. */
export function InjectedChatScene(): JSX.Element {
  return renderDevtoolsInStoryShadowRoot(<App />);
}

export function ChatReloadScene(): JSX.Element {
  const [generation, setGeneration] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setGeneration((value) => value + 1)}>
        Reload devtools
      </button>
      <App key={generation} />
    </div>
  );
}

/** Serves the saved conversation; its stream replays `events` first. */
export function installChatReloadServer(events: readonly IChatEvent[] = fixture_reloadEvents): VoidFunction {
  const restoreCatalog = installPageChatCatalog();
  const catalogFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalConfig: unknown = Reflect.get(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME);
  Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, {
    projectRootPath: fixture_reloadSession.projectRootPath,
    chatEnabled: true,
    statusEnabled: false,
    minimapEnabled: false,
    editorEnabled: false,
    externalToolbarsEnabled: false,
  });
  const sessions: IChatSession[] = [fixture_reloadSession];
  const fetch: FetchFunction = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.pathname === "/__devhost__/chat/sessions") {
      if (init?.method === "POST") {
        const session: IChatSession = { ...fixture_reloadSession, id: `new-conversation-${sessions.length}` };
        sessions.push(session);
        return Response.json(session);
      }
      return Response.json({ sessions });
    }
    return catalogFetch(input, init);
  };
  Reflect.set(globalThis, "fetch", fetch);
  Reflect.set(
    globalThis,
    "WebSocket",
    createMockWebSocket((connection) => {
      if (connection.url.pathname === "/__devhost__/ws/chat") {
        const session = sessions.find((candidate) => candidate.id === connection.url.searchParams.get("sessionId"));
        if (!session) throw new Error("The requested story chat session does not exist.");
        liveChatConnection = connection;
        connection.send({
          type: "snapshot",
          sessionId: session.id,
          session,
          events: session.id === fixture_reloadSession.id ? events : [],
          pendingRequestIds: [],
        });
      } else connection.send({ services: [] });
    }),
  );
  return () => {
    liveChatConnection = null;
    restoreCatalog();
    Reflect.set(globalThis, "WebSocket", originalWebSocket);
    Reflect.set(globalThis, DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME, originalConfig);
  };
}

export function UserMessageScene(): JSX.Element {
  const [messages] = useState<ThreadMessageLike[]>([
    {
      id: "user-message",
      role: "user",
      metadata: { custom: {} },
      content: [
        {
          type: "text",
          text: 'Improve This Layout\n\nPage context (the attached tab snapshot includes the annotations):\n{"title":"Example Page","url":"https://app.localhost/","markers":[],"shapes":[]}',
        },
      ],
    },
  ]);
  const runtime = useExternalStoreRuntime({ messages, convertMessage: (message) => message, onNew: async () => {} });
  return (
    <div className="h-100 bg-background text-foreground">
      <h2>User Message Preview</h2>
      <AssistantRuntimeProvider runtime={runtime}>
        <Thread autoFocus={false} emptyComposerPosition="bottom" components={{ UserText: ChatUserText }} />
      </AssistantRuntimeProvider>
    </div>
  );
}

export function ChatPreparationScene(): JSX.Element {
  const root = useRef<HTMLDivElement | null>(null);
  const [preparation] = useState(() => Promise.withResolvers<null>());
  const [isOpen, setIsOpen] = useState(true);
  const chat = useAgentChat({ pageURL: window.location.href, beforeSend: () => preparation.promise });
  return (
    <DevtoolsTopLayer ref={root}>
      <PortalProvider container={root}>
        <button type="button" className="pointer-events-auto" onClick={() => preparation.resolve(null)}>
          Cancel capture
        </button>
        <AgentChatPanel chat={chat} isOpen={isOpen} onClose={() => setIsOpen(false)}>
          {null}
        </AgentChatPanel>
      </PortalProvider>
    </DevtoolsTopLayer>
  );
}

interface IChatRequestsFixtureProps {
  request: IChatPendingRequest;
  events?: readonly IChatEvent[];
  target?: "all" | "approval" | "questions" | "field";
  shouldFail?: boolean;
}
export function ChatRequestsFixture({
  request,
  events = [],
  target = "all",
  shouldFail = false,
}: IChatRequestsFixtureProps): ReactElement {
  const [result, setResult] = useState("");
  const [answer, setAnswer] = useState<IChatQuestionSelection>({ selected: [], other: "", isOther: false });
  const respond = (requestId: ChatRequestId, response: unknown): void => {
    if (shouldFail) throw new Error("The native request is no longer pending.");
    setResult(JSON.stringify({ requestId, result: response }));
  };
  const interrupt = (): void => setResult("Interrupted");
  const approval = readChatApproval(request);
  const questions = readChatQuestions(request);
  const question = questions?.questions[0];
  return (
    <DensityProvider density="compact">
      <section className="pointer-events-auto flex max-w-md flex-col gap-2 text-foreground">
        {target === "approval" && approval ? (
          <ChatApprovalRequest
            request={request}
            approval={approval}
            events={events}
            respond={respond}
            interrupt={interrupt}
          />
        ) : target === "questions" && questions ? (
          <ChatQuestionRequest request={request} questions={questions} respond={respond} interrupt={interrupt} />
        ) : target === "field" && question ? (
          <ChatQuestionField question={question} value={answer} onChange={setAnswer} />
        ) : (
          <ApprovalRequests pendingRequests={[request]} events={events} respond={respond} interrupt={interrupt} />
        )}
        <output aria-label="Native response">{result || JSON.stringify(getChatQuestionAnswers(answer))}</output>
      </section>
    </DensityProvider>
  );
}

export function NativeQuestionsFixture(): ReactElement {
  return <ChatRequestsFixture request={fixture_codexQuestion} />;
}

export function PageChatScene(): JSX.Element {
  const rootReference = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [count, setCount] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setCount(count + 1)}>
        Page counter: {count}
      </button>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open chat
      </button>
      <DevtoolsTopLayer ref={rootReference}>
        <PageChat isOpen={isOpen} onOpenChange={setIsOpen} isSelectionEnabled rootReference={rootReference} />
      </DevtoolsTopLayer>
    </div>
  );
}

/** The page chat inside a devtools shadow root, as injected, beside host-page content it can annotate. */
// The DevTools Protocol addresses the top-level page, while a story renders in nested frames: offsets and scales
// a point in the story's viewport to the same point on that page.
function readTopLevelPoint(point: IAnnotationPoint): IAnnotationPoint {
  let x = point.x;
  let y = point.y;
  let frameWindow: Window = window;
  while (frameWindow.frameElement) {
    const frameBounds = frameWindow.frameElement.getBoundingClientRect();
    const scale = frameBounds.width / frameWindow.innerWidth;
    x = frameBounds.left + x * scale;
    y = frameBounds.top + y * scale;
    frameWindow = frameWindow.parent;
  }
  return { x, y };
}

type MouseEventPhase = "mousePressed" | "mouseMoved" | "mouseReleased";

async function sendMouseEvent(type: MouseEventPhase, point: IAnnotationPoint): Promise<void> {
  const { x, y } = readTopLevelPoint(point);
  await cdp().send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: 1,
  });
}

/** Drags with the real mouse from `from` to `to`; `keys` are pressed while the button is still down. */
export async function dragWithMouse(from: IAnnotationPoint, to: IAnnotationPoint, keys?: string): Promise<void> {
  await sendMouseEvent("mouseMoved", from);
  await sendMouseEvent("mousePressed", from);
  await sendMouseEvent("mouseMoved", to);
  if (keys) await nativeUserEvent.keyboard(keys);
  await sendMouseEvent("mouseReleased", to);
}

interface IShadowPageChatSceneProps {
  hasNativeLayers?: boolean;
}

export function ShadowPageChatScene({ hasNativeLayers = false }: IShadowPageChatSceneProps): JSX.Element {
  const rootReference = useRef<HTMLDivElement | null>(null);
  const dialogReference = useRef<HTMLDialogElement | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const [count, setCount] = useState(0);
  return (
    <div>
      <button type="button" onClick={() => setCount(count + 1)}>
        Page counter: {count}
      </button>
      {hasNativeLayers ? (
        <>
          <button type="button" onClick={() => dialogReference.current?.showModal()}>
            Open host modal
          </button>
          <dialog ref={dialogReference} aria-label="Host modal">
            <button type="button" onClick={() => setCount(count + 1)}>
              Modal counter: {count}
            </button>
            <button type="button" onClick={() => dialogReference.current?.close()}>
              Close host modal
            </button>
          </dialog>
        </>
      ) : null}
      {renderDevtoolsInStoryShadowRoot(
        <DevtoolsTopLayer ref={rootReference}>
          {hasNativeLayers ? (
            <DevtoolsToolbar
              collapsedIndicator={null}
              isMinimapVisible={false}
              position="bottom-right"
              stackName="native-layers"
            >
              <ToolbarPopover
                panelLabel="Native panel"
                panelWidth="sm"
                testId="NativePanel"
                triggerLabel="Native panel"
                triggerContent="Native panel"
              >
                <button type="button" onClick={() => setCount(count + 1)}>
                  Panel counter: {count}
                </button>
              </ToolbarPopover>
            </DevtoolsToolbar>
          ) : null}
          <PageChat isOpen={isOpen} onOpenChange={setIsOpen} isSelectionEnabled rootReference={rootReference} />
        </DevtoolsTopLayer>,
      )}
    </div>
  );
}

export function installPageChatCatalog(): VoidFunction {
  const originalFetch = globalThis.fetch;
  const fetch: FetchFunction = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
    if (url.pathname === "/__devhost__/chat/harnesses")
      return Response.json({
        harnesses: [
          {
            id: "codex",
            label: "Codex",
            available: true,
            models: [
              {
                id: "codex-discovered",
                label: "Discovered Codex model",
                description: "From installed harness",
                metadata: {},
              },
            ],
          },
          {
            id: "claude-code",
            label: "Claude Code",
            available: true,
            models: [
              {
                id: "claude-discovered",
                label: "Discovered Claude model",
                description: "From installed harness",
                metadata: {},
              },
            ],
          },
        ],
      });
    if (url.pathname === "/__devhost__/chat/sessions") return Response.json({ sessions: [] });
    return originalFetch(input, init);
  };
  Reflect.set(globalThis, "fetch", fetch);
  return () => Reflect.set(globalThis, "fetch", originalFetch);
}
