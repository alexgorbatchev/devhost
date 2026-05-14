import type { JSX } from "react";

export interface IAnnotationMarkerListItem {
  label: string;
  markerNumber: number;
}

interface IAnnotationMarkerListProps {
  items: IAnnotationMarkerListItem[];
  testId?: string;
}

export function AnnotationMarkerList(props: IAnnotationMarkerListProps): JSX.Element {
  return (
    <ol
      className="grid max-h-40 list-none gap-2 overflow-auto p-0"
      data-devhost-instance-testid={props.testId}
      data-testid="AnnotationMarkerList"
    >
      {props.items.map((item: IAnnotationMarkerListItem) => {
        return (
          <li key={item.markerNumber} className="grid grid-cols-[auto_1fr] items-center gap-2">
            <span className="grid size-6 min-w-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {item.markerNumber}
            </span>
            <span className="self-center leading-snug">
              <strong>#{item.markerNumber}</strong> {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
