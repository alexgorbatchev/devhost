/** @jsxImportSource preact */

import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";

import { css, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";

export interface IAnnotationMarkerListItem {
  label: string;
  markerNumber: number;
}

interface IAnnotationMarkerListDependencies {
  css: typeof css;
  theme: IDevtoolsTheme;
}

interface IAnnotationMarkerListProps {
  dependencies?: IAnnotationMarkerListDependencies;
  items: IAnnotationMarkerListItem[];
  listMargin?: CSSObject["margin"];
  testId?: string;
}

const markerListSize: number = 24;

export function AnnotationMarkerList(props: IAnnotationMarkerListProps): JSX.Element {
  const dependencies: IAnnotationMarkerListDependencies = {
    css: props.dependencies?.css ?? css,
    theme: props.dependencies?.theme ?? useDevtoolsTheme(),
  };
  const listClassName: string = dependencies.css(
    markerListStyle,
    props.listMargin === undefined
      ? undefined
      : {
          margin: props.listMargin,
        },
  );
  const itemClassName: string = dependencies.css(markerListItemStyle);
  const textClassName: string = dependencies.css(markerListTextStyle);
  const markerPillClassName: string = dependencies.css(createMarkerPillStyle(dependencies.theme));

  return (
    <ol class={listClassName} data-devhost-instance-testid={props.testId} data-testid="AnnotationMarkerList">
      {props.items.map((item: IAnnotationMarkerListItem) => {
        return (
          <li key={item.markerNumber} class={itemClassName}>
            <span class={markerPillClassName}>{item.markerNumber}</span>
            <span class={textClassName}>
              <strong>#{item.markerNumber}</strong> {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const markerListStyle: CSSObject = {
  display: "grid",
  gap: "8px",
  listStyle: "none",
  margin: 0,
  maxHeight: "160px",
  overflow: "auto",
  padding: 0,
};

const markerListItemStyle: CSSObject = {
  alignItems: "center",
  display: "grid",
  gap: "8px",
  gridTemplateColumns: "auto 1fr",
};

const markerListTextStyle: CSSObject = {
  alignSelf: "center",
  lineHeight: 1.35,
};

function createMarkerPillStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignSelf: "start",
    background: theme.colors.accentBackground,
    borderRadius: theme.radii.pill,
    color: theme.colors.accentForeground,
    display: "grid",
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    fontWeight: 700,
    height: `${markerListSize}px`,
    minWidth: `${markerListSize}px`,
    placeItems: "center",
  };
}
