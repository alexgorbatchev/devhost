import { useEffect, type JSX } from "react";

import { App as DevtoolsApp } from "../src/devtools/components/App";
import {
  registerAnnotationSelectionPlugin,
  type IAnnotationSelectionCandidate,
  type IAnnotationSelectionPlugin,
} from "../src/devtools/features/annotationComposer";
import type { IAnnotationMarkerPayload } from "../src/devtools/features/annotationComposer/types";
import { renderDevtoolsInStoryShadowRoot } from "../src/devtools/shared/components/stories/helpers";

interface IOverviewTarget {
  element: string;
  id: string;
  label: string;
  selector: string;
}

const overviewTargets: IOverviewTarget[] = [
  { element: "button", id: "hl-btn", label: "WelcomeSection > button", selector: '[data-mock-target="button"]' },
  { element: "div", id: "hl-card", label: "ServiceHealthPanel", selector: '[data-mock-target="card"]' },
];

// Marks the two showcase targets under component-style labels instead of resolving the element under the pointer.
const overviewSelectionPlugin: IAnnotationSelectionPlugin = {
  id: "mock-overview-selection",
  label: "Mock Selection",
  matches: (): boolean => true,
  priority: 100,
  resolveCandidate: (event: MouseEvent): IAnnotationSelectionCandidate | null => {
    if (!(event.target instanceof Element)) {
      return null;
    }

    for (const target of overviewTargets) {
      const element: Element | null = event.target.closest(target.selector);

      if (element !== null) {
        return createOverviewCandidate(target, element);
      }
    }

    return null;
  },
};

function createOverviewCandidate(target: IOverviewTarget, element: Element): IAnnotationSelectionCandidate {
  return {
    buildMarkerPayload: async (markerNumber: number): Promise<IAnnotationMarkerPayload> => {
      return {
        accessibility: "",
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        computedStyles: "",
        computedStylesObj: {},
        cssClasses: "",
        element: target.element,
        elementPath: target.element,
        fullPath: target.element,
        isFixed: false,
        markerNumber,
        nearbyElements: "",
        nearbyText: "",
      };
    },
    id: target.id,
    label: target.label,
    readRect: (): DOMRect => element.getBoundingClientRect(),
  };
}

export function DesignOverviewScene(): JSX.Element {
  useEffect(() => registerAnnotationSelectionPlugin(overviewSelectionPlugin), []);

  return (
    <div
      style={{
        position: "relative",
        minHeight: "750px",
        width: "100%",
        padding: "16px",
        backgroundColor: "#0f172a",
        color: "#f8fafc",
        fontFamily: "sans-serif",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        boxSizing: "border-box",
      }}
    >
      {/* Host Page Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 16px",
          borderBottom: "1px solid #1e293b",
          backgroundColor: "rgba(2, 6, 23, 0.8)",
          borderRadius: "6px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "4px",
              backgroundColor: "#6366f1",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "monospace",
              fontSize: "12px",
              fontWeight: "bold",
              color: "#ffffff",
            }}
          >
            D
          </div>
          <span style={{ fontWeight: 600, fontSize: "14px", letterSpacing: "-0.01em", color: "#ffffff" }}>
            Devhost Dashboard
          </span>
        </div>
        <nav style={{ display: "flex", gap: "16px", fontSize: "12px", fontWeight: 500, color: "#94a3b8" }}>
          <span style={{ color: "#f1f5f9" }}>Dashboard</span>
          <span>Deployments</span>
          <span>Metrics</span>
          <span>Settings</span>
        </nav>
      </header>

      {/* Main Content Areas */}
      <main
        style={{
          flex: "1 1 0%",
          maxWidth: "896px",
          margin: "0 auto",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
          boxSizing: "border-box",
        }}
      >
        <section
          style={{
            backgroundColor: "#020617",
            padding: "24px",
            borderRadius: "8px",
            border: "1px solid #1e293b",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", color: "#ffffff" }}>
            Build & Dev Environment Overview
          </h1>
          <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8", lineHeight: 1.6, maxWidth: "512px" }}>
            Welcome to your live developer workspace. The Devhost container is running on your localhost domain. We've
            highlighted key interactive interface elements on the host app to showcase how Agent Pi can trace,
            source-map, and rewrite components inline.
          </p>
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              data-mock-target="button"
              type="button"
              style={{
                cursor: "pointer",
                padding: "6px 16px",
                backgroundColor: "#4f46e5",
                border: "none",
                color: "#ffffff",
                fontWeight: 500,
                fontSize: "12px",
                borderRadius: "4px",
              }}
            >
              Get Started
            </button>
            <button
              type="button"
              style={{
                cursor: "pointer",
                padding: "6px 16px",
                backgroundColor: "#1e293b",
                border: "none",
                color: "#f1f5f9",
                fontWeight: 500,
                fontSize: "12px",
                borderRadius: "4px",
              }}
            >
              Read Documentation
            </button>
          </div>
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", boxSizing: "border-box" }}>
          <div
            data-mock-target="card"
            style={{
              backgroundColor: "#020617",
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid #1e293b",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              boxSizing: "border-box",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#ffffff" }}>Service Health status</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#34d399" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "9999px", backgroundColor: "#34d399" }} />
              <span>All 6 microservices operational</span>
            </div>
            <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8", lineHeight: 1.4 }}>
              Active logs are being streamed dynamically into the visual minimap on the right.
            </p>
          </div>

          <div
            style={{
              backgroundColor: "#020617",
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid #1e293b",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              boxSizing: "border-box",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "#ffffff" }}>Newsletter Signup</h3>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="email"
                placeholder="you@example.com"
                style={{
                  flex: "1 1 0%",
                  backgroundColor: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: "4px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  color: "#f1f5f9",
                  outline: "none",
                }}
              />
              <button
                type="button"
                style={{
                  cursor: "pointer",
                  padding: "4px 12px",
                  backgroundColor: "#4f46e5",
                  border: "none",
                  color: "#ffffff",
                  fontSize: "12px",
                  fontWeight: 500,
                  borderRadius: "4px",
                }}
              >
                Subscribe
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Render Devtools UI in the Shadow DOM Root */}
      {renderDevtoolsInStoryShadowRoot(<DevtoolsApp />)}
    </div>
  );
}
