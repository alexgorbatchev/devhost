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
      className="m-0 grid max-h-24 list-none gap-0.5 overflow-auto p-0"
      data-devhost-instance-testid={props.testId}
      data-testid="AnnotationMarkerList"
    >
      {props.items.map((item: IAnnotationMarkerListItem) => {
        return (
          <li key={item.markerNumber} className="flex min-w-0 items-center gap-1.5">
            <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-mark px-[3px] text-sm font-bold text-mark-foreground">
              {item.markerNumber}
            </span>
            <span className="min-w-0 truncate" title={item.label}>
              {item.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
