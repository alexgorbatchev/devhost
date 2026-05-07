import { useEffect, useRef } from "react";
import type { JSX, RefObject } from "react";

interface ISourceLocation {
  columnNumber?: number;
  componentName?: string;
  fileName: string;
  lineNumber: number;
}

interface ICaptureSourceCardSurfaceProps {
  source: ISourceLocation;
}

interface ICaptureSourceContentProps {
  __source: ISourceLocation;
}

interface ICaptureSourceContentWithRefProps extends ICaptureSourceContentProps {
  sourceCardRef: RefObject<HTMLDivElement | null>;
}

export function CaptureSourceCardSurface({ source }: ICaptureSourceCardSurfaceProps): JSX.Element {
  const sourceCardRef = useRef<HTMLDivElement | null>(null);
  const captureSourceContentProps: ICaptureSourceContentProps = { __source: source };

  useEffect((): void => {
    sourceCardRef.current?.setAttribute("data-capture-source-card-ready", "true");
    window.dispatchEvent(new Event("devhost-capture-source-card-ready"));
  }, []);

  return <CaptureSourceContent {...captureSourceContentProps} sourceCardRef={sourceCardRef} />;
}

function CaptureSourceContent({ __source, sourceCardRef }: ICaptureSourceContentWithRefProps): JSX.Element {
  return (
    <article data-testid="CaptureSourceContent">
      <div
        className="captureCard captureSourceCard"
        data-devhost-cursor="pointer"
        data-testid="CaptureSourceContent--source-card"
        ref={sourceCardRef}
      >
        <p className="captureLabel">Source navigation</p>
        <h2>Capture source card</h2>
        <p>Alt-right-click this card to open the real devtools source navigation menu and launch an editor session.</p>
        <dl className="captureSourceMetadata">
          <div>
            <dt>Component</dt>
            <dd>{__source.componentName ?? "Unknown component"}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd>{__source.fileName}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>
              {__source.lineNumber}:{__source.columnNumber ?? "?"}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}
