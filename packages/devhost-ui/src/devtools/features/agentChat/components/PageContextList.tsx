import { Button } from "@alexgorbatchev/shadcn";
import { Trash2Icon, XIcon } from "lucide-react";
import type { JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import type { ISelectedAnnotationTarget } from "../../annotationComposer/annotationComposerModels";
import type { IAnnotationShape } from "../../visualAnnotations/types";

interface IPageContextListProps {
  targets: ISelectedAnnotationTarget[];
  shapes: IAnnotationShape[];
  isDisabled: boolean;
  onRemoveTarget: (id: string) => void;
  onRemoveShape: (id: string) => void;
  onClear: () => void;
}

export function PageContextList({
  targets,
  shapes,
  isDisabled,
  onRemoveTarget,
  onRemoveShape,
  onClear,
}: IPageContextListProps): JSX.Element | null {
  if (targets.length + shapes.length === 0) return null;
  return (
    <section
      data-testid="PageContextList"
      aria-label="Page context"
      className="max-h-40 overflow-auto border-b border-border p-2"
    >
      <ul className="flex flex-col gap-1">
        {targets.map((target) => (
          <li key={target.candidate.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">
              #{target.markerNumber} {target.candidate.label}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={isDisabled}
              aria-label={`Remove Element ${target.markerNumber}`}
              onClick={() => onRemoveTarget(target.candidate.id)}
            >
              <Icon glyph={XIcon} />
            </Button>
          </li>
        ))}
        {shapes.map((shape, index) => (
          <li key={shape.id} className="flex items-center justify-between gap-2">
            <span>
              {index + 1}. {shape.kind}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={isDisabled}
              aria-label={`Remove ${shape.kind[0]?.toUpperCase()}${shape.kind.slice(1)} ${index + 1}`}
              onClick={() => onRemoveShape(shape.id)}
            >
              <Icon glyph={XIcon} />
            </Button>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="ghost" disabled={isDisabled} onClick={onClear}>
        <Icon glyph={Trash2Icon} />
        Clear Page Context
      </Button>
    </section>
  );
}
