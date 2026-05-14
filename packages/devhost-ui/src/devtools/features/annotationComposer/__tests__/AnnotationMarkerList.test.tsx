import assert from "node:assert";

import { describe, expect, test } from "bun:test";
import type { ReactNode, ReactElement } from "react";

import { AnnotationMarkerList, type IAnnotationMarkerListItem } from "../components/AnnotationMarkerList";

const FIXTURE_MARKER_ITEMS: IAnnotationMarkerListItem[] = [
  {
    label: 'button "Save changes"',
    markerNumber: 1,
  },
  {
    label: 'input "Email address"',
    markerNumber: 2,
  },
];

describe("AnnotationMarkerList", () => {
  test("renders the shared marker list structure for each item", () => {
    const markerList = AnnotationMarkerList({
      items: FIXTURE_MARKER_ITEMS,
      testId: "AnnotationComposer--marker-list",
    });
    const listItems = readChildren(markerList);
    const firstListItem = listItems[0];
    const secondListItem = listItems[1];

    assert(firstListItem !== undefined);
    assert(secondListItem !== undefined);
    assert(isVNode(firstListItem));
    assert(isVNode(secondListItem));

    expect(markerList.type).toBe("ol");
    expect(markerList.props["data-devhost-instance-testid"]).toBe("AnnotationComposer--marker-list");
    expect(markerList.props["data-testid"]).toBe("AnnotationMarkerList");
    expect(listItems).toHaveLength(2);

    expect(readMarkerListItem(firstListItem)).toEqual({
      labelText: ' button "Save changes"',
      markerNumber: 1,
      strongText: "#1",
    });
    expect(readMarkerListItem(secondListItem)).toEqual({
      labelText: ' input "Email address"',
      markerNumber: 2,
      strongText: "#2",
    });
  });
});

interface IRenderedMarkerListItem {
  labelText: string;
  markerNumber: number;
  strongText: string;
}

function isVNode(value: ReactNode): value is ReactElement {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

interface IWithChildrenProps {
  children?: ReactNode | ReactNode[];
}

function readChildren(vnode: ReactElement): ReactNode[] {
  const props = vnode.props as IWithChildrenProps;
  return new Array<ReactNode>().concat(props.children ?? []);
}

function readMarkerListItem(listItem: ReactElement): IRenderedMarkerListItem {
  const listItemChildren = readChildren(listItem);
  const markerPill = listItemChildren[0];
  const markerText = listItemChildren[1];

  assert(markerPill !== undefined);
  assert(markerText !== undefined);
  assert(isVNode(markerPill));
  assert(isVNode(markerText));

  const markerTextChildren = readChildren(markerText);
  const markerStrong = markerTextChildren[0];
  const markerLabelText = readTextValue(markerTextChildren.slice(1));

  assert(markerStrong !== undefined);
  assert(isVNode(markerStrong));
  const markerPillProps = markerPill.props as IWithChildrenProps;
  const markerStrongProps = markerStrong.props as IWithChildrenProps;
  assert(typeof markerPillProps.children === "number");

  return {
    labelText: markerLabelText,
    markerNumber: markerPillProps.children,
    strongText: readTextValue(markerStrongProps.children),
  };
}

type ComponentChildCollection = ReactNode | ReactNode[];

function readTextValue(value: ComponentChildCollection): string {
  return new Array<ReactNode>().concat(value ?? []).join("");
}
