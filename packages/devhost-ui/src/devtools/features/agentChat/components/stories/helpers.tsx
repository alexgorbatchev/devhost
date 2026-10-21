import type { IChatQuestionSelection } from "../../questions/types";
import { getChatQuestionAnswers } from "../../questions/getChatQuestionAnswers";
import { DevtoolsTopLayer } from "../../../../shared/components/DevtoolsTopLayer";
import { PageChat } from "../PageChat";
import { fixture_codexQuestion } from "../../questions/components/stories/fixtures";
import { DensityProvider, PortalProvider } from "@alexgorbatchev/shadcn";
import { useRef, useState, type JSX, type ReactElement } from "react";
import type { ChatRequestId, IChatEvent, IChatPendingRequest } from "../../types";
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
