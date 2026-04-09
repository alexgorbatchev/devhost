import { useRef, useState, type JSX, type KeyboardEvent } from "react";

import { InsetList, SectionHeader, Surface, TerminalSnippet } from "../../components/ui";
import { FeatureHighlightPanel } from "./FeatureHighlightPanel";
import { featureHighlights, type FeatureHighlightId, type IFeatureHighlight } from "./featureHighlights";

const bindInputSnippet: readonly string[] = [
  "DEVHOST_BIND_HOST\nPORT\n\nDEVHOST_HOST\nDEVHOST_PATH\nDEVHOST_SERVICE_NAME\nDEVHOST_MANIFEST_PATH",
];

const bindInputNotes: readonly string[] = [
  "Bind sockets with DEVHOST_BIND_HOST and PORT.",
  "Use DEVHOST_HOST and DEVHOST_PATH as public routing context.",
  "Keep manifest metadata available without confusing it for bind configuration.",
];

const initialFeatureHighlight: IFeatureHighlight = readInitialFeatureHighlight();

type FeatureTabRefSetter = (element: HTMLButtonElement | null) => void;

export function FeatureSection(): JSX.Element {
  const [activeFeatureId, setActiveFeatureId] = useState<FeatureHighlightId>(initialFeatureHighlight.id);
  const featureTabRefs = useRef<Map<FeatureHighlightId, HTMLButtonElement>>(new Map());
  const activeFeature = readFeatureHighlight(activeFeatureId);
  const activeFeaturePanelId: string = createFeaturePanelId(activeFeature.id);
  const activeFeatureTabId: string = createFeatureTabId(activeFeature.id);

  function handleFeatureTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, featureId: FeatureHighlightId): void {
    const currentFeatureIndex: number = findFeatureIndexById(featureId);
    const lastFeatureIndex: number = featureHighlights.length - 1;

    let nextFeatureIndex: number | null = null;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight": {
        nextFeatureIndex = currentFeatureIndex === lastFeatureIndex ? 0 : currentFeatureIndex + 1;
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        nextFeatureIndex = currentFeatureIndex === 0 ? lastFeatureIndex : currentFeatureIndex - 1;
        break;
      }
      case "Home": {
        nextFeatureIndex = 0;
        break;
      }
      case "End": {
        nextFeatureIndex = lastFeatureIndex;
        break;
      }
      default: {
        return;
      }
    }

    event.preventDefault();

    if (nextFeatureIndex === null) {
      return;
    }

    const nextFeatureHighlight = featureHighlights[nextFeatureIndex];

    if (nextFeatureHighlight === undefined) {
      return;
    }

    setActiveFeatureId(nextFeatureHighlight.id);
    featureTabRefs.current.get(nextFeatureHighlight.id)?.focus();
  }

  return (
    <section className="grid gap-4" aria-labelledby="feature-section-title" data-testid="FeatureSection">
      <SectionHeader
        description="Routing is only the beginning. devhost also owns the stack lifecycle, runtime context, browser tooling, and agent handoff that make the routed page genuinely useful to work on."
        title="The route is just the start."
        titleId="feature-section-title"
      />

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <Surface className="p-2">
          <div className="grid gap-2" role="tablist" aria-label="Devhost capability highlights" aria-orientation="vertical">
            {featureHighlights.map((featureHighlight: IFeatureHighlight, index: number) => {
              const isActive: boolean = featureHighlight.id === activeFeature.id;

              return (
                <button
                  key={featureHighlight.id}
                  id={createFeatureTabId(featureHighlight.id)}
                  ref={createFeatureTabRef(featureTabRefs.current, featureHighlight.id)}
                  type="button"
                  role="tab"
                  className={readFeatureTabClassName(isActive)}
                  aria-controls={createFeaturePanelId(featureHighlight.id)}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={(): void => {
                    setActiveFeatureId(featureHighlight.id);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                    handleFeatureTabKeyDown(event, featureHighlight.id);
                  }}
                >
                  <span>{featureHighlight.tabLabel}</span>
                  <span aria-hidden="true" className="text-[0.72rem] uppercase tracking-[0.22em] opacity-70">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </button>
              );
            })}
          </div>
        </Surface>

        <Surface
          element="article"
          className="p-5 sm:p-6"
          id={activeFeaturePanelId}
          role="tabpanel"
          aria-labelledby={activeFeatureTabId}
        >
          <FeatureHighlightPanel {...activeFeature} />
        </Surface>

        <Surface element="aside" className="grid gap-4 p-5" tone="subtle" aria-labelledby="feature-proof-card-title">
          <div className="grid gap-3">
            <h3
              id="feature-proof-card-title"
              className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground"
            >
              Runtime context without guesswork
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              devhost passes both bind inputs and routed metadata into the process. The important part is that the
              contract stays explicit, so your app knows what to listen on and what public context it is serving.
            </p>
          </div>

          <TerminalSnippet snippets={bindInputSnippet} />
          <InsetList items={bindInputNotes} />
        </Surface>
      </div>
    </section>
  );
}

function createFeaturePanelId(featureHighlightId: FeatureHighlightId): string {
  return `feature-panel-${featureHighlightId}`;
}

function createFeatureTabId(featureHighlightId: FeatureHighlightId): string {
  return `feature-tab-${featureHighlightId}`;
}

function createFeatureTabRef(
  featureTabRefs: Map<FeatureHighlightId, HTMLButtonElement>,
  featureId: FeatureHighlightId,
): FeatureTabRefSetter {
  return (element: HTMLButtonElement | null): void => {
    if (element === null) {
      featureTabRefs.delete(featureId);
      return;
    }

    featureTabRefs.set(featureId, element);
  };
}

function findFeatureIndexById(featureId: FeatureHighlightId): number {
  const featureIndex: number = featureHighlights.findIndex((featureHighlight: IFeatureHighlight) => {
    return featureHighlight.id === featureId;
  });

  if (featureIndex === -1) {
    throw new Error(`Missing feature tab for id: ${featureId}`);
  }

  return featureIndex;
}

function readFeatureHighlight(featureId: FeatureHighlightId): IFeatureHighlight {
  const featureHighlight = featureHighlights.find((candidateFeatureHighlight: IFeatureHighlight) => {
    return candidateFeatureHighlight.id === featureId;
  });

  if (featureHighlight === undefined) {
    throw new Error(`Missing feature highlight for id: ${featureId}`);
  }

  return featureHighlight;
}

function readInitialFeatureHighlight(): IFeatureHighlight {
  const featureHighlight = featureHighlights[0];

  if (featureHighlight === undefined) {
    throw new Error("Feature highlights must define at least one tab.");
  }

  return featureHighlight;
}

function readFeatureTabClassName(isActive: boolean): string {
  if (isActive) {
    return "flex w-full items-center justify-between rounded-md border border-transparent bg-primary px-3 py-3 text-left text-sm leading-5 text-primary-foreground shadow-[var(--shadow-soft)]";
  }

  return "flex w-full items-center justify-between rounded-md border border-transparent px-3 py-3 text-left text-sm leading-5 text-muted-foreground transition hover:border-border-subtle hover:bg-surface-subtle hover:text-foreground";
}
