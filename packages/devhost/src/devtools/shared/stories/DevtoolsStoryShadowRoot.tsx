import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState } from "react";

import { DEVTOOLS_ROOT_ATTRIBUTE_NAME } from "../constants";
import { configureDevtoolsCss, injectGlobal } from "../devtoolsCss";

interface IDevtoolsStoryShadowRootProps {
  children: ReactNode;
}

const devtoolsStoryShadowRootGlobalStyles: CSSObject = {
  ":host": {
    color: "initial",
  },
  "*, *::before, *::after": {
    boxSizing: "border-box",
  },
  button: {
    font: "inherit",
  },
  input: {
    font: "inherit",
  },
  textarea: {
    font: "inherit",
  },
};

export const devtoolsStoryShadowRootHostTestId: string = "DevtoolsStoryShadowRoot";

export function renderInDevtoolsStoryShadowRoot(children: ReactNode): JSX.Element {
  return <DevtoolsStoryShadowRoot>{children}</DevtoolsStoryShadowRoot>;
}

export function readShadowRoot(hostElement: HTMLElement, errorMessage: string): ShadowRoot {
  const shadowRoot: ShadowRoot | null = hostElement.shadowRoot;

  if (shadowRoot === null) {
    throw new Error(errorMessage);
  }

  return shadowRoot;
}

function DevtoolsStoryShadowRoot(props: IDevtoolsStoryShadowRootProps): JSX.Element {
  const hostElementReference = useRef<HTMLDivElement | null>(null);
  const [shadowMountNode, setShadowMountNode] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const hostElement: HTMLDivElement | null = hostElementReference.current;

    if (hostElement === null) {
      return;
    }

    const shadowRoot: ShadowRoot = hostElement.shadowRoot ?? hostElement.attachShadow({ mode: "open" });
    const mountNode: HTMLDivElement = document.createElement("div");

    mountNode.setAttribute(DEVTOOLS_ROOT_ATTRIBUTE_NAME, "");
    shadowRoot.append(mountNode);

    configureDevtoolsCss(shadowRoot);
    injectGlobal(devtoolsStoryShadowRootGlobalStyles);
    setShadowMountNode(mountNode);

    return () => {
      setShadowMountNode(null);
      mountNode.remove();
    };
  }, []);

  return (
    <div data-testid={devtoolsStoryShadowRootHostTestId} ref={hostElementReference}>
      {shadowMountNode ? createPortal(props.children, shadowMountNode) : null}
    </div>
  );
}
