import { ANNOTATION_LAYER_SELECTOR, DEVTOOLS_ROOT_ATTRIBUTE_NAME, TOP_LAYER_ELEMENT_SELECTOR } from "./constants";
import { installDevtoolsStyles } from "./devtoolsStyles";
import {
  promoteAnnotationTopLayer,
  restackAboveAnnotationTopLayer,
  type IAnnotationTopLayerOrder,
} from "./promoteAnnotationTopLayer";

interface IAnnotationTopLayerOptions extends Omit<IAnnotationTopLayerOrder, "cover"> {
  host: HTMLElement;
  mount: HTMLElement;
  readCover: () => HTMLElement | null;
}

type AnnotationTree = Document | ShadowRoot;
type AnnotationSubtree = Element | AnnotationTree;

/** Keeps only the owned annotation mount in the active modal/popover's interaction scope. */
export function observeAnnotationTopLayer({
  home,
  host,
  layer,
  mount,
  placement,
  readCover,
}: IAnnotationTopLayerOptions): VoidFunction {
  const document = home.ownerDocument;
  const roots = new Map<AnnotationTree, MutationObserver>();
  const opened: HTMLElement[] = [];
  let isDisposed = false;
  let isScheduled = false;
  let shouldPromote = true;

  const isDevtoolsOwned = (element: Element): boolean =>
    element === home || element.closest(`[${DEVTOOLS_ROOT_ATTRIBUTE_NAME}]`) !== null;
  // The mount follows the modal or popover the user is annotating. Another annotation layer never is one, and a
  // layer below the devtools surfaces annotates the host page only.
  const isTarget = (element: Element): element is HTMLElement =>
    element instanceof HTMLElement &&
    element !== home &&
    element !== layer &&
    !layer.contains(element) &&
    !element.matches(ANNOTATION_LAYER_SELECTOR) &&
    !(placement === "below-devtools" && isDevtoolsOwned(element)) &&
    element.matches(TOP_LAYER_ELEMENT_SELECTOR);

  const synchronize = (): void => {
    isScheduled = false;
    if (isDisposed || !home.isConnected) return;
    for (const [root, observer] of roots) {
      if (root instanceof ShadowRoot && !root.host.isConnected) {
        observer.disconnect();
        root.removeEventListener("toggle", handleToggle, true);
        root.removeEventListener("close", schedule, true);
        roots.delete(root);
      }
    }
    const colorScheme = getComputedStyle(home).getPropertyValue("--devhost-color-scheme").trim();
    if (host.getAttribute("data-theme") !== colorScheme) host.setAttribute("data-theme", colorScheme);
    const candidates = Array.from(roots.keys()).flatMap((root) =>
      Array.from(root.querySelectorAll(TOP_LAYER_ELEMENT_SELECTOR)),
    );
    for (const element of candidates) {
      if (isTarget(element) && !opened.includes(element)) {
        opened.push(element);
        shouldPromote = true;
      }
    }
    const active = opened.filter((element) => element.isConnected && element.matches(TOP_LAYER_ELEMENT_SELECTOR));
    opened.splice(0, opened.length, ...active);

    // Native hit testing identifies the currently blocking dialog, including dialogs already open at mount and
    // multiple sibling dialogs whose opening order differs from DOM order. An inert dialog never wins a hit test.
    let hit = document.elementFromPoint(0, 0);
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(0, 0);
      if (inner === null || inner === hit) break;
      hit = inner;
    }
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    const modal =
      findModalAncestor(hit) ??
      findModalAncestor(focused) ??
      active.findLast((element) => element.matches(":modal")) ??
      null;
    const popovers = active.filter(
      (element) => element.matches(":popover-open") && (modal === null || isWithin(element, modal)),
    );
    // Auto/hint popovers light-dismiss on outside clicks; manual popovers do not. Keep annotation clicks in the
    // active dismissible chain even when an unrelated manual popover was opened more recently.
    const popover = popovers.findLast((element) => element.popover !== "manual") ?? popovers.at(-1);
    const parent = popover ?? modal ?? home;
    const root = parent.getRootNode();
    if (root === home.getRootNode()) {
      if (mount.parentNode !== parent) parent.append(mount);
      host.remove();
    } else {
      if (host.parentNode !== parent) parent.append(host);
      const shadow = host.shadowRoot;
      if (shadow !== null) {
        if (mount.parentNode !== shadow) shadow.append(mount);
        installDevtoolsStyles(shadow);
      }
    }
    const order: IAnnotationTopLayerOrder = { home, layer, placement, cover: readCover() };
    if (!layer.matches(":popover-open")) {
      layer.showPopover();
      restackAboveAnnotationTopLayer(order);
    } else if (shouldPromote) promoteAnnotationTopLayer(order);
    shouldPromote = false;
  };

  const schedule = (): void => {
    if (isScheduled || isDisposed) return;
    isScheduled = true;
    // Run after the ordinary devtools root's own toggle listener has finished promoting that root.
    queueMicrotask(synchronize);
  };
  const handleToggle = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target === layer || layer.contains(target)) return;
    // A layer below the devtools surfaces follows host top-layer elements only: it re-enters the devtools root and
    // chat after itself, and their own re-entry must not send it back above them.
    if (placement === "below-devtools" && isDevtoolsOwned(target)) return;
    shouldPromote = true;
    if (target.matches(TOP_LAYER_ELEMENT_SELECTOR)) {
      const index = opened.indexOf(target);
      if (index !== -1) opened.splice(index, 1);
      if (isTarget(target)) opened.push(target);
    }
    schedule();
  };
  const handleMutations = (records: MutationRecord[]): void => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node !== host && node !== mount) discover(node);
      }
    }
    schedule();
  };
  const observe = (root: AnnotationTree): void => {
    if (roots.has(root) || root === host.shadowRoot) return;
    const observer = new MutationObserver(handleMutations);
    roots.set(root, observer);
    root.addEventListener("toggle", handleToggle, true);
    root.addEventListener("close", schedule, true);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "popover", "data-theme"],
    });
    discover(root);
  };
  const discover = (node: AnnotationSubtree): void => {
    if (node instanceof Element && node.shadowRoot !== null) observe(node.shadowRoot);
    for (const element of node.querySelectorAll("*")) {
      if (element !== host && element.shadowRoot !== null) observe(element.shadowRoot);
    }
  };
  const handleFocus = (event: Event): void => {
    // A dialog opened inside a newly attached shadow root focuses within it. Its composed path exposes that root
    // even though attaching a shadow root itself does not produce a document mutation.
    for (const node of event.composedPath()) {
      if (node instanceof ShadowRoot) observe(node);
    }
    schedule();
  };

  document.addEventListener("focusin", handleFocus, true);
  observe(document);
  const homeTree = home.getRootNode();
  if (homeTree instanceof ShadowRoot) observe(homeTree);
  synchronize();

  return () => {
    isDisposed = true;
    document.removeEventListener("focusin", handleFocus, true);
    for (const [root, observer] of roots) {
      observer.disconnect();
      root.removeEventListener("toggle", handleToggle, true);
      root.removeEventListener("close", schedule, true);
    }
    if (layer.matches(":popover-open")) layer.hidePopover();
    if (mount.isConnected) home.append(mount);
    host.remove();
  };
}

function findModalAncestor(element: Element | null): HTMLElement | null {
  let current = element;
  while (current !== null) {
    if (current instanceof HTMLElement && current.matches(":modal")) return current;
    const root = current.getRootNode();
    current = current.assignedSlot ?? current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return null;
}

function isWithin(element: Element, ancestor: Element): boolean {
  let current: Element | null = element;
  while (current !== null) {
    if (current === ancestor) return true;
    const root = current.getRootNode();
    current = current.assignedSlot ?? current.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}
