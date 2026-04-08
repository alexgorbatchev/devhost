import {
  getElementSourceLocation,
  getFiberFromElement,
  readComponentName,
  readDirectSource,
  readOwnerFiber,
  readParentFiber,
  type IReactFiberNode,
} from "../../shared/reactSourceInspection";
import { normalizeSourceLocation, type ISourceLocation } from "../../shared/sourceLocation";
import { symbolicateSourceLocation } from "../../shared/symbolicateSourceLocation";

export interface IComponentInspection {
  displayName: string;
  props: Record<string, string>;
  source: ISourceLocation;
}

interface IRawComponentInspection {
  displayName: string;
  props: Record<string, string>;
  source: ISourceLocation;
}

export async function inspectComponentElement(element: HTMLElement): Promise<IComponentInspection[]> {
  const seenFibers: Set<IReactFiberNode> = new Set<IReactFiberNode>();
  const rawInspections: IRawComponentInspection[] = [];
  const firstFiber: IReactFiberNode | null = getFiberFromElement(element);
  const fallbackSource: ISourceLocation | undefined = await getElementSourceLocation(element);

  if (fallbackSource !== undefined) {
    rawInspections.push({
      displayName: fallbackSource.componentName ?? readFiberDisplayName(firstFiber),
      props: firstFiber === null ? {} : getProps(firstFiber),
      source: fallbackSource,
    });
  }

  let currentFiber: IReactFiberNode | null = firstFiber;

  while (currentFiber !== null) {
    if (seenFibers.has(currentFiber)) {
      break;
    }

    seenFibers.add(currentFiber);

    const source: ISourceLocation | null = readDirectSource(currentFiber);

    if (source !== null) {
      rawInspections.push({
        displayName: source.componentName ?? readFiberDisplayName(currentFiber),
        props: getProps(currentFiber),
        source,
      });
    }

    currentFiber = readOwnerFiber(currentFiber) ?? readParentFiber(currentFiber);
  }

  const normalizedInspections: IComponentInspection[] = [];
  const seenSources: Set<string> = new Set<string>();

  for (const rawInspection of rawInspections) {
    const symbolicatedSource: ISourceLocation | undefined = await symbolicateSourceLocation(rawInspection.source);
    const normalizedSource: ISourceLocation = normalizeSourceLocation(symbolicatedSource ?? rawInspection.source);
    const sourceKey: string = [
      normalizedSource.fileName,
      String(normalizedSource.lineNumber),
      String(normalizedSource.columnNumber ?? 0),
    ].join(":");

    if (seenSources.has(sourceKey)) {
      continue;
    }

    seenSources.add(sourceKey);
    normalizedInspections.push({
      displayName: normalizedSource.componentName ?? rawInspection.displayName,
      props: rawInspection.props,
      source: normalizedSource,
    });
  }

  return normalizedInspections;
}

function getProps(fiber: IReactFiberNode): Record<string, string> {
  const memoizedProps: Record<string, unknown> | undefined = fiber.memoizedProps;

  if (memoizedProps === undefined) {
    return {};
  }

  const props: Record<string, string> = {};

  for (const [key, value] of Object.entries(memoizedProps)) {
    if (key === "key") {
      continue;
    }

    const defaultPropValue: unknown = readDefaultPropValue(fiber, key);

    if (value === defaultPropValue) {
      continue;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      props[key] = String(value);
    }
  }

  return props;
}

function readDefaultPropValue(fiber: IReactFiberNode, key: string): unknown {
  const componentType: unknown = fiber.type;

  if (typeof componentType !== "object" || componentType === null) {
    return undefined;
  }

  const defaultProps: unknown = Reflect.get(componentType, "defaultProps");

  if (typeof defaultProps !== "object" || defaultProps === null) {
    return undefined;
  }

  return Reflect.get(defaultProps, key);
}

function readFiberDisplayName(fiber: IReactFiberNode | null): string {
  if (fiber === null) {
    return "Component";
  }

  return readComponentName(fiber) ?? "Component";
}
