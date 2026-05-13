import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState, type JSX, type ReactNode, type RefCallback } from "react";
import { expect, waitFor, within } from "storybook/test";

import { getDevtoolsTheme, type DevtoolsColorScheme } from "../../../shared/devtoolsTheme";
import { ThemeProvider } from "../../../shared/ThemeProvider";
import { StoryContainer } from "../../../shared/stories/StoryContainer";
import { readStorybookDevtoolsColorScheme } from "../../../shared/stories/storybookTheme";
import {
  AnnotationSelectionOverlay,
  createDomAnnotationSelectionCandidateForElement,
  type ISelectedAnnotationTarget,
} from "../index";

interface IAnnotationSelectionOverlayStoryFrameProps {
  children: ReactNode;
}

interface IAnnotationSelectionOverlayPositioningSceneProps {
  colorScheme: DevtoolsColorScheme;
}

interface ILayoutTargetDefinition {
  background: string;
  borderRadius: string;
  id: string;
  text: string;
}

const layoutTargetDefinitions: ILayoutTargetDefinition[] = [
  {
    background: "#f97316",
    borderRadius: "10px",
    id: "flow-block",
    text: "static block flow",
  },
  {
    background: "#8b5cf6",
    borderRadius: "999px",
    id: "inline-wrap",
    text: "inline flow wrap",
  },
  {
    background: "#0ea5e9",
    borderRadius: "12px",
    id: "flex-end",
    text: "flex row end aligned",
  },
  {
    background: "#ef4444",
    borderRadius: "16px",
    id: "grid-span",
    text: "grid column span",
  },
  {
    background: "#10b981",
    borderRadius: "14px",
    id: "grid-end",
    text: "grid justify-self end",
  },
  {
    background: "#eab308",
    borderRadius: "12px",
    id: "relative-offset",
    text: "relative offset",
  },
  {
    background: "#ec4899",
    borderRadius: "8px",
    id: "absolute-corner",
    text: "absolute inside relative frame",
  },
];
const overlayGeometryToleranceInPixels: number = 8;

function AnnotationSelectionOverlayStoryFrame({ children }: IAnnotationSelectionOverlayStoryFrameProps): JSX.Element {
  return <StoryContainer align="center">{children}</StoryContainer>;
}

function findLayoutTargetDefinition(targetId: string): ILayoutTargetDefinition {
  const targetDefinition = layoutTargetDefinitions.find((candidate) => candidate.id === targetId);

  if (targetDefinition === undefined) {
    throw new Error(`Unknown layout target: ${targetId}`);
  }

  return targetDefinition;
}

interface ILayoutTargetProps {
  targetId: string;
  targetReference: RefCallback<HTMLButtonElement>;
  width?: string;
}

function LayoutTarget({ targetId, targetReference, width }: ILayoutTargetProps): JSX.Element {
  const targetDefinition = findLayoutTargetDefinition(targetId);

  return (
    <button
      ref={targetReference}
      type="button"
      aria-label={targetDefinition.text}
      style={{
        width,
        minHeight: "38px",
        padding: "10px 14px",
        border: "0",
        borderRadius: targetDefinition.borderRadius,
        background: targetDefinition.background,
        color: "#111827",
        fontSize: "12px",
        fontWeight: 700,
        lineHeight: 1.4,
        textAlign: "left",
      }}
    >
      {targetDefinition.text}
    </button>
  );
}

function AnnotationSelectionOverlayPositioningScene({
  colorScheme,
}: IAnnotationSelectionOverlayPositioningSceneProps): JSX.Element {
  const [targetElements, setTargetElements] = useState<Record<string, HTMLButtonElement>>({});
  const selectedTargets: ISelectedAnnotationTarget[] = useMemo(() => {
    return layoutTargetDefinitions.flatMap((targetDefinition, index) => {
      const element = targetElements[targetDefinition.id];

      if (element === undefined) {
        return [];
      }

      return [
        {
          candidate: createDomAnnotationSelectionCandidateForElement({ element }),
          markerNumber: index + 1,
        },
      ];
    });
  }, [targetElements]);
  const targetReferences: Record<string, RefCallback<HTMLButtonElement>> = useMemo(() => {
    return Object.fromEntries(
      layoutTargetDefinitions.map((targetDefinition) => {
        const targetReference: RefCallback<HTMLButtonElement> = (element) => {
          setTargetElements((currentTargetElements) => {
            if (element === null) {
              const { [targetDefinition.id]: removedTarget, ...remainingTargetElements } = currentTargetElements;

              return removedTarget === undefined ? currentTargetElements : remainingTargetElements;
            }

            return currentTargetElements[targetDefinition.id] === element
              ? currentTargetElements
              : { ...currentTargetElements, [targetDefinition.id]: element };
          });
        };

        return [targetDefinition.id, targetReference];
      }),
    );
  }, []);

  return (
    <AnnotationSelectionOverlayStoryFrame>
      <div
        data-testid="AnnotationSelectionOverlayPositioningScene"
        style={{
          position: "relative",
          display: "grid",
          gap: "24px",
          width: "420px",
          padding: "20px",
          borderRadius: "20px",
          background: "linear-gradient(180deg, #dbeafe 0%, #f8fafc 100%)",
          boxSizing: "border-box",
        }}
      >
        <section style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>Normal document flow</div>
          <LayoutTarget targetId="flow-block" targetReference={targetReferences["flow-block"]} width="180px" />
          <div style={{ fontSize: "12px", lineHeight: 1.6, color: "#475569" }}>
            Inline content before{" "}
            <LayoutTarget targetId="inline-wrap" targetReference={targetReferences["inline-wrap"]} /> after to verify
            inline wrapping and baseline placement.
          </div>
        </section>

        <section style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>Flex layout</div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "14px",
              borderRadius: "16px",
              background: "rgba(255, 255, 255, 0.68)",
            }}
          >
            <span style={{ color: "#475569", fontSize: "12px" }}>Leading text</span>
            <div style={{ marginLeft: "auto" }}>
              <LayoutTarget targetId="flex-end" targetReference={targetReferences["flex-end"]} width="170px" />
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gap: "12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>Grid layout</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: "12px",
              padding: "14px",
              borderRadius: "16px",
              background: "rgba(255, 255, 255, 0.68)",
            }}
          >
            <div style={{ height: "40px", borderRadius: "10px", background: "rgba(148, 163, 184, 0.24)" }} />
            <div style={{ gridColumn: "2 / span 2" }}>
              <LayoutTarget targetId="grid-span" targetReference={targetReferences["grid-span"]} width="100%" />
            </div>
            <div style={{ height: "40px", borderRadius: "10px", background: "rgba(148, 163, 184, 0.24)" }} />
            <div
              style={{
                gridColumn: "1 / span 2",
                height: "54px",
                borderRadius: "10px",
                background: "rgba(148, 163, 184, 0.24)",
              }}
            />
            <div style={{ justifySelf: "end" }}>
              <LayoutTarget targetId="grid-end" targetReference={targetReferences["grid-end"]} width="150px" />
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div
            style={{
              display: "grid",
              gap: "10px",
              padding: "14px",
              borderRadius: "16px",
              background: "rgba(255, 255, 255, 0.68)",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>Relative positioning</div>
            <div style={{ position: "relative", minHeight: "72px", borderRadius: "12px", background: "#e2e8f0" }}>
              <div style={{ position: "relative", top: "12px", left: "18px", display: "inline-block" }}>
                <LayoutTarget
                  targetId="relative-offset"
                  targetReference={targetReferences["relative-offset"]}
                  width="140px"
                />
              </div>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: "10px",
              padding: "14px",
              borderRadius: "16px",
              background: "rgba(255, 255, 255, 0.68)",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>Absolute positioning</div>
            <div style={{ position: "relative", minHeight: "112px", borderRadius: "12px", background: "#e2e8f0" }}>
              <div style={{ position: "absolute", right: "12px", bottom: "12px" }}>
                <LayoutTarget
                  targetId="absolute-corner"
                  targetReference={targetReferences["absolute-corner"]}
                  width="190px"
                />
              </div>
            </div>
          </div>
        </section>

        <div data-devhost-devtools="">
          <ThemeProvider colorScheme={colorScheme}>
            <AnnotationSelectionOverlay selectedTargets={selectedTargets} />
          </ThemeProvider>
        </div>
      </div>
    </AnnotationSelectionOverlayStoryFrame>
  );
}

interface IAnnotationSelectionOverlayPositioningPreviewProps {
  globals: Partial<Record<string, unknown>>;
}

function AnnotationSelectionOverlayPositioningPreview({
  globals,
}: IAnnotationSelectionOverlayPositioningPreviewProps): JSX.Element {
  const colorScheme: DevtoolsColorScheme = readStorybookDevtoolsColorScheme(globals);

  return (
    <section
      aria-label="positioning overlay preview"
      data-testid="AnnotationSelectionOverlayPositioningPreview"
      style={{
        alignItems: "start",
        display: "grid",
        gap: "24px",
        gridTemplateColumns: "minmax(0, 320px) minmax(0, 520px)",
        paddingBottom: "120vh",
        width: "100%",
        maxWidth: "900px",
      }}
    >
      <AnnotationSelectionOverlayContainedStageSingleTargetPreview />
      <AnnotationSelectionOverlayPositioningScene colorScheme={colorScheme} />
    </section>
  );
}

function AnnotationSelectionOverlaySingleTargetScene({
  colorScheme,
}: IAnnotationSelectionOverlayPositioningSceneProps): JSX.Element {
  const [targetElement, setTargetElement] = useState<HTMLButtonElement | null>(null);
  const selectedTargets: ISelectedAnnotationTarget[] = useMemo(() => {
    if (targetElement === null) {
      return [];
    }

    return [
      {
        candidate: createDomAnnotationSelectionCandidateForElement({ element: targetElement }),
        markerNumber: 1,
      },
    ];
  }, [targetElement]);

  return (
    <div
      data-testid={`AnnotationSelectionOverlaySingleTargetScene--${colorScheme}`}
      style={{
        display: "grid",
        gap: "16px",
        position: "relative",
        width: "100%",
      }}
    >
      <button
        ref={setTargetElement}
        type="button"
        aria-label={`single highlighted target ${colorScheme}`}
        style={{
          background: colorScheme === "light" ? "#38bdf8" : "#a855f7",
          border: "0",
          borderRadius: "12px",
          color: "#0f172a",
          fontSize: "12px",
          fontWeight: 700,
          minHeight: "44px",
          padding: "12px 16px",
          textAlign: "left",
          width: "220px",
        }}
      >
        single contained stage target
      </button>
      <div data-devhost-devtools="">
        <ThemeProvider colorScheme={colorScheme}>
          <AnnotationSelectionOverlay selectedTargets={selectedTargets} testIdPrefix="ContainedStageSelectionOverlay" />
        </ThemeProvider>
      </div>
    </div>
  );
}

function AnnotationSelectionOverlayContainedStageSingleTargetPreview(): JSX.Element {
  const colorScheme: DevtoolsColorScheme = "light";
  const theme = getDevtoolsTheme(colorScheme);

  return (
    <section
      aria-label={`${colorScheme} preview`}
      data-testid="ContainedStageSingleTargetPreview"
      style={{
        boxSizing: "border-box",
        color: theme.colors.foreground,
        display: "grid",
        minWidth: 0,
        padding: theme.spacing.lg,
        position: "relative",
      }}
    >
      <div
        style={{
          alignItems: "center",
          boxSizing: "border-box",
          contain: "layout paint",
          display: "grid",
          height: "100%",
          justifyItems: "center",
          minHeight: "320px",
          overflow: "hidden",
          padding: theme.spacing.xl,
          position: "relative",
          transform: "translateZ(0)",
          width: "100%",
        }}
      >
        <AnnotationSelectionOverlaySingleTargetScene colorScheme={colorScheme} />
      </div>
    </section>
  );
}

const meta: Meta<typeof AnnotationSelectionOverlay> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/annotationComposer/AnnotationSelectionOverlay",
  component: AnnotationSelectionOverlay,
  render: (_args, context) => {
    return <AnnotationSelectionOverlayPositioningPreview globals={context.globals} />;
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

const Default: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const canvas = within(canvasElement);
    const documentBody: HTMLElement = canvasElement.ownerDocument.body;
    const page = within(documentBody);

    window.scrollTo({ left: 0, top: 0 });

    await waitFor(() => {
      expect(canvas.getByTestId("AnnotationSelectionOverlayPositioningPreview")).toBeInTheDocument();
      expect(canvas.getByTestId("ContainedStageSingleTargetPreview")).toBeInTheDocument();
      expect(page.getAllByTestId("AnnotationSelectionOverlay")).toHaveLength(2);
      expect(page.getAllByTestId("AnnotationSelectionOverlay--selection-highlight")).toHaveLength(
        layoutTargetDefinitions.length,
      );
      expect(page.getAllByTestId("AnnotationSelectionOverlay--marker")).toHaveLength(layoutTargetDefinitions.length);
      expect(page.getByTestId("ContainedStageSelectionOverlay--selection-highlight")).toBeInTheDocument();
      expect(page.getByTestId("ContainedStageSelectionOverlay--marker")).toBeInTheDocument();
    });

    const containedStageTarget: HTMLElement = canvas.getByRole("button", {
      name: "single highlighted target light",
    });
    const containedStageHighlight: HTMLElement = page.getByTestId(
      "ContainedStageSelectionOverlay--selection-highlight",
    );
    const containedStageMarker: HTMLElement = page.getByTestId("ContainedStageSelectionOverlay--marker");
    const expectContainedStageHighlightToMatchTarget = (): void => {
      const targetRectangle: DOMRect = containedStageTarget.getBoundingClientRect();
      const highlightRectangle: DOMRect = containedStageHighlight.getBoundingClientRect();

      expect(Math.abs(highlightRectangle.x - (targetRectangle.x - 2))).toBeLessThanOrEqual(
        overlayGeometryToleranceInPixels,
      );
      expect(Math.abs(highlightRectangle.y - (targetRectangle.y - 1))).toBeLessThanOrEqual(
        overlayGeometryToleranceInPixels,
      );
      expect(Math.abs(highlightRectangle.width - (targetRectangle.width + 4))).toBeLessThanOrEqual(
        overlayGeometryToleranceInPixels,
      );
      expect(Math.abs(highlightRectangle.height - (targetRectangle.height + 2))).toBeLessThanOrEqual(
        overlayGeometryToleranceInPixels,
      );
    };
    const expectContainedStageMarkerToStayAnchoredToHighlight = (): void => {
      const highlightRectangle: DOMRect = containedStageHighlight.getBoundingClientRect();
      const markerRectangle: DOMRect = containedStageMarker.getBoundingClientRect();
      const markerCenterX: number = markerRectangle.x + markerRectangle.width / 2;
      const markerCenterY: number = markerRectangle.y + markerRectangle.height / 2;
      const visibleHighlightCornerX: number = Math.min(Math.max(highlightRectangle.x, 0), window.innerWidth);
      const visibleHighlightCornerY: number = Math.min(Math.max(highlightRectangle.y, 0), window.innerHeight);

      expect(Math.abs(markerCenterX - visibleHighlightCornerX)).toBeLessThanOrEqual(1);
      expect(Math.abs(markerCenterY - visibleHighlightCornerY)).toBeLessThanOrEqual(1);
    };

    await waitFor(() => {
      expectContainedStageHighlightToMatchTarget();
      expectContainedStageMarkerToStayAnchoredToHighlight();
    });

    window.scrollTo({ left: 0, top: 150 });

    await waitFor(() => {
      expect(window.scrollY).toBeGreaterThanOrEqual(150);
      expectContainedStageHighlightToMatchTarget();
      expectContainedStageMarkerToStayAnchoredToHighlight();
    });

    window.scrollTo({ left: 0, top: 0 });
  },
};

export { Default as AnnotationSelectionOverlay };
