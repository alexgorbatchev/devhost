import assert from "node:assert";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ComponentChild, VNode } from "preact";

import { getDevtoolsTheme } from "../../../shared/devtoolsTheme";
import { AnnotationMarkerList, type IAnnotationMarkerListItem } from "../AnnotationMarkerList";

const cssMock = mock((..._args: unknown[]): string => "mock-class-name");

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

beforeEach(() => {
  cssMock.mockClear();
});

describe("AnnotationMarkerList", () => {
  test("renders the shared marker list structure for each item", () => {
    const markerList = AnnotationMarkerList({
      dependencies: {
        css: cssMock,
        theme: getDevtoolsTheme("dark"),
      },
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

  test("forwards list margin overrides into the root list styles", () => {
    AnnotationMarkerList({
      dependencies: {
        css: cssMock,
        theme: getDevtoolsTheme("dark"),
      },
      items: FIXTURE_MARKER_ITEMS,
      listMargin: "4px 0",
      testId: "AnnotationComposer--marker-list",
    });

    const rootCssCall = cssMock.mock.calls[0];

    assert(rootCssCall !== undefined);
    expect(rootCssCall[1]).toEqual({ margin: "4px 0" });
  });
});

interface IRenderedMarkerListItem {
  labelText: string;
  markerNumber: number;
  strongText: string;
}

function isVNode(value: ComponentChild): value is VNode {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

function readChildren(vnode: VNode): ComponentChild[] {
  return new Array<ComponentChild>().concat(vnode.props.children ?? []);
}

function readMarkerListItem(listItem: VNode): IRenderedMarkerListItem {
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
  assert(typeof markerPill.props.children === "number");

  return {
    labelText: markerLabelText,
    markerNumber: markerPill.props.children,
    strongText: readTextValue(markerStrong.props.children),
  };
}

type ComponentChildCollection = ComponentChild | ComponentChild[];

function readTextValue(value: ComponentChildCollection): string {
  return new Array<ComponentChild>().concat(value ?? []).join("");
}
