import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { AlertCircleIcon, CheckIcon, CopyIcon, TriangleAlertIcon, XIcon } from "lucide-react";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../../../components/ui/Alert";

type InlineNoticeTone = "default" | "danger";
type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "error"; message: string };

interface IInlineNoticeProps {
  action?: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
  testId?: string;
  title?: ReactNode;
  tone?: InlineNoticeTone;
}

export function InlineNotice({
  action,
  children,
  onDismiss,
  testId,
  title,
  tone = "default",
}: IInlineNoticeProps): JSX.Element {
  const descriptionReference = useRef<HTMLDivElement | null>(null);
  const titleReference = useRef<HTMLDivElement | null>(null);
  const [copyState, setCopyState] = useState<CopyState>({ kind: "idle" });
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  const scheduleReset = (): void => {
    if (resetTimer.current !== null) {
      clearTimeout(resetTimer.current);
    }
    resetTimer.current = setTimeout(() => setCopyState({ kind: "idle" }), 3000);
  };

  const handleCopy = async (): Promise<void> => {
    const titleText = titleReference.current?.textContent?.trim() ?? "";
    const bodyText = descriptionReference.current?.textContent?.trim() ?? "";
    const payload = titleText.length > 0 && bodyText.length > 0 ? `${titleText}\n\n${bodyText}` : titleText || bodyText;
    if (payload.length === 0) {
      return;
    }
    if (typeof navigator === "undefined" || navigator.clipboard === undefined) {
      setCopyState({
        kind: "error",
        message: "Clipboard unavailable (requires a secure context: https or localhost).",
      });
      scheduleReset();
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      setCopyState({ kind: "copied" });
      scheduleReset();
    } catch (error) {
      setCopyState({
        kind: "error",
        message: error instanceof Error ? error.message : "Copy failed.",
      });
      scheduleReset();
    }
  };

  const showCopy = tone === "danger";
  const hasAction = action !== undefined || onDismiss !== undefined || showCopy;

  let copyIcon: JSX.Element;
  let copyLabel: string;
  if (copyState.kind === "copied") {
    copyIcon = <CheckIcon aria-hidden="true" />;
    copyLabel = "Copied";
  } else if (copyState.kind === "error") {
    copyIcon = <AlertCircleIcon aria-hidden="true" />;
    copyLabel = `Copy failed: ${copyState.message}`;
  } else {
    copyIcon = <CopyIcon aria-hidden="true" />;
    copyLabel = "Copy to clipboard";
  }

  return (
    <Alert data-testid={testId} variant={tone === "danger" ? "destructive" : "default"}>
      {tone === "danger" ? <TriangleAlertIcon aria-hidden="true" /> : null}
      {title !== undefined ? <AlertTitle ref={titleReference}>{title}</AlertTitle> : null}
      <AlertDescription ref={descriptionReference}>
        {children}
        {copyState.kind === "error" ? (
          <span
            className="mt-0.5 block text-sm font-normal opacity-90"
            data-testid="InlineNotice--copyError"
            role="status"
          >
            {copyState.message}
          </span>
        ) : null}
      </AlertDescription>
      {hasAction ? (
        <AlertAction>
          {action}
          {showCopy ? (
            <button
              aria-label={copyLabel}
              className="grid size-5 place-items-center rounded-sm text-current hover:bg-black/15 [&_svg]:size-3.5"
              data-testid="InlineNotice--copy"
              title={copyLabel}
              type="button"
              onClick={() => {
                void handleCopy();
              }}
            >
              {copyIcon}
            </button>
          ) : null}
          {onDismiss !== undefined ? (
            // Inherits the notice color so the control stays legible on the solid danger strip.
            <button
              aria-label="Dismiss"
              className="grid size-5 place-items-center rounded-sm text-current hover:bg-black/15 [&_svg]:size-3.5"
              data-testid="InlineNotice--dismiss"
              title="Dismiss"
              type="button"
              onClick={onDismiss}
            >
              <XIcon aria-hidden="true" />
            </button>
          ) : null}
        </AlertAction>
      ) : null}
    </Alert>
  );
}
