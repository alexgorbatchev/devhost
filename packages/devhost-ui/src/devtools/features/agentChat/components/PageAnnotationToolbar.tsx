import { Button, DensityProvider, ToggleGroup, ToggleGroupItem } from "@alexgorbatchev/shadcn";
import { ArrowUpRightIcon, MinusIcon, MousePointer2Icon, SquareIcon, Undo2Icon } from "lucide-react";
import type { JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import type { AnnotationShapeKind } from "../../visualAnnotations/types";

interface IPageAnnotationToolbarProps {
  tool: AnnotationShapeKind | null;
  isSelecting: boolean;
  isDisabled: boolean;
  canUndo: boolean;
  onToolChange: (tool: AnnotationShapeKind | "select" | null) => void;
  onUndo: () => void;
}

export function PageAnnotationToolbar({
  tool,
  isSelecting,
  isDisabled,
  canUndo,
  onToolChange,
  onUndo,
}: IPageAnnotationToolbarProps): JSX.Element {
  const active = isSelecting ? "select" : tool;
  return (
    <DensityProvider density="comfortable">
      <div
        role="toolbar"
        aria-label="Page Annotation Tools"
        data-devhost-capture-exclude=""
        data-devhost-annotation-controls=""
        className="pointer-events-auto fixed top-2 left-1/2 z-(--devhost-z-annotation-controls) flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-2 rounded-md border border-edge bg-card p-2 text-card-foreground shadow-frame [--ag-control-h:36px]"
      >
        <ToggleGroup
          value={active ? [active] : []}
          disabled={isDisabled}
          size="lg"
          variant="outline"
          spacing={1}
          onValueChange={(values) => {
            const value = values[0];
            onToolChange(value === "select" || value === "arrow" || value === "line" || value === "box" ? value : null);
          }}
        >
          <ToggleGroupItem value="select" aria-label="Select Elements" title="Select Elements">
            <Icon glyph={MousePointer2Icon} />
          </ToggleGroupItem>
          <ToggleGroupItem value="arrow" aria-label="Arrow" title="Arrow">
            <Icon glyph={ArrowUpRightIcon} />
          </ToggleGroupItem>
          <ToggleGroupItem value="line" aria-label="Line" title="Line">
            <Icon glyph={MinusIcon} />
          </ToggleGroupItem>
          <ToggleGroupItem value="box" aria-label="Box" title="Box">
            <Icon glyph={SquareIcon} />
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          size="icon-lg"
          variant="ghost"
          disabled={isDisabled || !canUndo}
          onClick={onUndo}
          aria-label="Undo Drawing"
          title="Undo Drawing"
        >
          <Icon glyph={Undo2Icon} />
        </Button>
      </div>
    </DensityProvider>
  );
}
