import type { Meta, StoryObj } from "@storybook/react";
import { useId, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { expect, fn, waitFor, within } from "storybook/test";
import { userEvent } from "vitest/browser";

import { AnnotationTopLayer } from "../AnnotationTopLayer";
import { DevtoolsTopLayer } from "../DevtoolsTopLayer";
import { readDevtoolsStoryShadowCanvas, renderDevtoolsInStoryShadowRoot } from "./helpers";

interface IAnnotationLayerSceneProps {
  isInitiallyVisible?: boolean;
  isInitiallyMounted?: boolean;
  hasShadowModal?: boolean;
  hasSlottedPopover?: boolean;
}

function AnnotationLayerScene({
  isInitiallyVisible = true,
  isInitiallyMounted = true,
  hasShadowModal = false,
  hasSlottedPopover = false,
}: IAnnotationLayerSceneProps): JSX.Element {
  const reference = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();
  const modal = useRef<HTMLDialogElement | null>(null);
  const nestedModal = useRef<HTMLDialogElement | null>(null);
  const modalHost = useRef<HTMLDivElement | null>(null);
  const [modalTree, setModalTree] = useState<ShadowRoot | null>(null);
  const [hasModalRoot, setHasModalRoot] = useState(true);
  const [isVisible, setIsVisible] = useState(isInitiallyVisible);
  const [isMounted, setIsMounted] = useState(isInitiallyMounted);
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    const host = modalHost.current;
    if (host !== null) setModalTree(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  }, []);
  const dialogs = (
    <>
      <dialog
        ref={nestedModal}
        aria-label="Nested modal"
        className="fixed top-1/2 left-1/2 m-0 -translate-x-1/2 -translate-y-1/2"
      >
        <button type="button" onClick={() => nestedModal.current?.close()}>
          Close nested modal
        </button>
      </dialog>
      <dialog
        ref={modal}
        aria-label="Layer modal"
        className="fixed top-1/2 left-1/2 m-0 -translate-x-1/2 -translate-y-1/2"
      >
        <button type="button" onClick={() => modal.current?.close()}>
          Close modal
        </button>
        <button type="button" onClick={() => nestedModal.current?.showModal()}>
          Open nested modal
        </button>
        <button type="button" onClick={() => setIsMounted(true)}>
          Mount annotations
        </button>
        <button type="button" onClick={() => setHasModalRoot(false)}>
          Remove host modal
        </button>
        <details>
          <summary>Retained host details</summary>Old component state
        </details>
        <slot />
      </dialog>
    </>
  );
  return (
    <>
      <button type="button" className="fixed top-40 left-1/2" onClick={() => modal.current?.showModal()}>
        Open modal
      </button>
      {hasShadowModal && hasModalRoot ? (
        <div ref={modalHost} data-testid="HostModalShadow">
          {hasSlottedPopover ? (
            <>
              <button type="button" popoverTarget={popoverId}>
                Open slotted popover
              </button>
              <section id={popoverId} popover="auto" aria-label="Slotted popover">
                Slotted content
              </section>
            </>
          ) : null}
        </div>
      ) : hasShadowModal ? null : (
        dialogs
      )}
      {modalTree === null ? null : createPortal(dialogs, modalTree)}
      {renderDevtoolsInStoryShadowRoot(
        <DevtoolsTopLayer>
          <button
            type="button"
            className="pointer-events-auto fixed bottom-2 left-2"
            onClick={() => setIsVisible(!isVisible)}
          >
            Toggle tools
          </button>
          {isMounted ? (
            <AnnotationTopLayer ref={reference} isVisible={isVisible}>
              <div className="pointer-events-auto fixed top-2 left-2">
                <button type="button" onClick={() => setCount(count + 1)}>
                  Annotation action: {count}
                </button>
                <button type="button" onClick={() => setIsMounted(false)}>
                  Unmount annotations
                </button>
              </div>
            </AnnotationTopLayer>
          ) : null}
        </DevtoolsTopLayer>,
      )}
    </>
  );
}

const meta: Meta<typeof AnnotationTopLayer> = {
  component: AnnotationTopLayer,
  title: "@alexgorbatchev/devhost-ui/devtools/shared/components/AnnotationTopLayer",
  render: () => <AnnotationLayerScene />,
};
export default meta;
type Story = StoryObj<typeof meta>;

async function openHostModal(canvasElement: HTMLElement): Promise<void> {
  const trigger = within(canvasElement).getByRole("button", { name: "Open modal" });
  const bounds = trigger.getBoundingClientRect();
  expect(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)).toBe(trigger);
  await userEvent.click(trigger);
}

export const VisibleTools: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Annotation action: 0" }));
    await expect(canvas.getByRole("button", { name: "Annotation action: 1" })).toBeVisible();
  },
};

export const HiddenTools: Story = {
  render: () => <AnnotationLayerScene isInitiallyVisible={false} />,
  play: async ({ canvasElement }) => {
    const canvas = await readDevtoolsStoryShadowCanvas(canvasElement);
    expect(canvas.queryByRole("button", { name: "Annotation action: 0" })).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Toggle tools" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Annotation action: 0" }));
    await expect(canvas.getByRole("button", { name: "Annotation action: 1" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Toggle tools" }));
    await expect(canvas.queryByRole("button", { name: "Annotation action: 1" })).toBeNull();
  },
};

export const CleanupInsideModal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devtools = await readDevtoolsStoryShadowCanvas(canvasElement);
    const action = await devtools.findByRole("button", { name: "Annotation action: 0" });
    const unmount = devtools.getByRole("button", { name: "Unmount annotations" });
    const mount = devtools.getByTestId("AnnotationTopLayer--surface").parentElement;
    await openHostModal(canvasElement);
    await userEvent.click(action);
    await expect(action).toHaveTextContent("Annotation action: 1");
    const modal = canvas.getByRole("dialog", { name: "Layer modal" });
    await userEvent.click(unmount);
    await waitFor(() => expect(modal.querySelector("[data-devhost-annotation-host]")).toBeNull());
    expect(mount?.isConnected).toBe(false);
    expect(modal.matches(":modal")).toBe(true);
    await userEvent.click(within(modal).getByRole("button", { name: "Close modal" }));
    await userEvent.click(devtools.getByRole("button", { name: "Toggle tools" }));
    expect(modal.matches(":modal")).toBe(false);
  },
};

export const PreviouslyOpenModal: Story = {
  render: () => <AnnotationLayerScene isInitiallyMounted={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openHostModal(canvasElement);
    const modal = canvas.getByRole("dialog", { name: "Layer modal" });
    await userEvent.click(within(modal).getByRole("button", { name: "Mount annotations" }));
    await waitFor(() => expect(modal.querySelector("[data-devhost-annotation-host]")).not.toBeNull());
    const host = modal.querySelector<HTMLElement>("[data-devhost-annotation-host]")!;
    const surface = host.shadowRoot!.querySelector<HTMLElement>("[data-devhost-annotation-layer]")!;
    await userEvent.click(within(surface).getByRole("button", { name: "Annotation action: 0" }));
    await expect(within(surface).getByRole("button", { name: "Annotation action: 1" })).toBeVisible();
    expect(modal.matches(":modal")).toBe(true);
  },
};

export const NestedModals: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devtools = await readDevtoolsStoryShadowCanvas(canvasElement);
    const action = await devtools.findByRole("button", { name: "Annotation action: 0" });
    await openHostModal(canvasElement);
    const first = canvas.getByRole("dialog", { name: "Layer modal" });
    const trigger = within(first).getByRole("button", { name: "Open nested modal" });
    await userEvent.click(trigger);
    const second = canvas.getByRole("dialog", { name: "Nested modal" });
    await userEvent.click(action);
    const host = (action.getRootNode() as ShadowRoot).host;
    expect(host.parentElement).toBe(second);
    await userEvent.click(within(second).getByRole("button", { name: "Close nested modal" }));
    await waitFor(() => expect(host.parentElement).toBe(first));
    await userEvent.click(action);
    await expect(action).toHaveTextContent("Annotation action: 2");
    await userEvent.click(within(first).getByRole("button", { name: "Close modal" }));
    await expect(devtools.getByRole("button", { name: "Annotation action: 2" })).toBeVisible();
  },
};

export const ModalInHostShadowRoot: Story = {
  render: () => <AnnotationLayerScene hasShadowModal />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devtools = await readDevtoolsStoryShadowCanvas(canvasElement);
    const action = await devtools.findByRole("button", { name: "Annotation action: 0" });
    await openHostModal(canvasElement);
    const tree = canvas.getByTestId("HostModalShadow").shadowRoot!;
    const modal = tree.querySelector<HTMLDialogElement>("dialog[aria-label='Layer modal']")!;
    await userEvent.click(action);
    await expect(action).toHaveTextContent("Annotation action: 1");
    expect(modal.matches(":modal")).toBe(true);
    await userEvent.click(within(modal).getByRole("button", { name: "Close modal" }));
    await expect(devtools.getByRole("button", { name: "Annotation action: 1" })).toBeVisible();
  },
};

export const SlottedPopoverInModal: Story = {
  render: () => <AnnotationLayerScene hasShadowModal hasSlottedPopover />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devtools = await readDevtoolsStoryShadowCanvas(canvasElement);
    const action = await devtools.findByRole("button", { name: "Annotation action: 0" });
    await openHostModal(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Open slotted popover" }));
    const popover = canvas.getByRole("region", { name: "Slotted popover" });
    await waitFor(() => expect(popover.matches(":popover-open")).toBe(true));
    await userEvent.click(action);
    expect(popover.matches(":popover-open")).toBe(true);
    await expect(action).toHaveTextContent("Annotation action: 1");
  },
};

export const RemovedHostShadowRoot: Story = {
  render: () => <AnnotationLayerScene hasShadowModal />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const devtools = await readDevtoolsStoryShadowCanvas(canvasElement);
    const action = await devtools.findByRole("button", { name: "Annotation action: 0" });
    const surface = devtools.getByTestId("AnnotationTopLayer--surface");
    await openHostModal(canvasElement);
    const oldTree = canvas.getByTestId("HostModalShadow").shadowRoot!;
    const modal = oldTree.querySelector<HTMLDialogElement>("dialog[aria-label='Layer modal']")!;
    const details = oldTree.querySelector("details")!;
    await userEvent.click(within(modal).getByRole("button", { name: "Remove host modal" }));
    await waitFor(() => expect(devtools.getByRole("button", { name: "Annotation action: 0" })).toBeVisible());
    const reentry = fn();
    surface.addEventListener("beforetoggle", reentry);
    // A host script can retain and update its detached component; devhost must stop observing it.
    const toggled = new Promise<void>((resolve) => details.addEventListener("toggle", () => resolve(), { once: true }));
    details.open = true;
    await toggled;
    expect(reentry).not.toHaveBeenCalled();
    surface.removeEventListener("beforetoggle", reentry);
    await userEvent.click(action);
    await expect(action).toHaveTextContent("Annotation action: 1");
  },
};
