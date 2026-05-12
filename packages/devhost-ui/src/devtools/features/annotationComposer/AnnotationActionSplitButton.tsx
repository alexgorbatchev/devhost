import { useEffect, useId, useRef, useState, type JSX } from "react";

import { cn } from "@/lib/utils";

import { Button, type IAnnotationAction } from "../../shared";

interface IAnnotationActionSplitButtonProps {
  actions: IAnnotationAction[];
  isActionMenuDisabled: boolean;
  isRunDisabled: boolean;
  selectedAction: IAnnotationAction;
  onActionSelect: (actionId: string) => void;
  onRun: () => void;
}

export function AnnotationActionSplitButton({
  actions,
  isActionMenuDisabled,
  isRunDisabled,
  selectedAction,
  onActionSelect,
  onRun,
}: IAnnotationActionSplitButtonProps): JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const rootReference = useRef<HTMLDivElement | null>(null);
  const menuId: string = useId();

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (isNodeInsideContainer(rootReference.current, event.target)) {
        return;
      }

      setIsMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isActionMenuDisabled || !isMenuOpen) {
      return;
    }

    setIsMenuOpen(false);
  }, [isActionMenuDisabled, isMenuOpen]);

  return (
    <div ref={rootReference} className="relative inline-flex gap-px" data-testid="AnnotationActionSplitButton">
      <Button disabled={isRunDisabled} endEnhancer="⌘ ↵" variant="primary" onClick={onRun}>
        {`Run ${selectedAction.displayName}`}
      </Button>
      <Button
        ariaControls={isMenuOpen ? menuId : undefined}
        ariaExpanded={isMenuOpen}
        ariaHaspopup="menu"
        ariaLabel={`Select annotation action. Current: ${selectedAction.displayName}`}
        disabled={isActionMenuDisabled}
        testId="AnnotationActionSplitButton--action-menu-toggle"
        variant="primary"
        onClick={(): void => {
          setIsMenuOpen((currentValue: boolean): boolean => !currentValue);
        }}
      >
        ▾
      </Button>
      {isMenuOpen ? (
        <div
          aria-label="Annotation actions"
          className="absolute right-0 top-[calc(100%+4px)] z-[2147483501] grid min-w-[220px] gap-1 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
          id={menuId}
          role="menu"
        >
          {actions.map((action: IAnnotationAction) => {
            const isSelectedAction: boolean = action.id === selectedAction.id;

            return (
              <button
                key={action.id}
                aria-checked={isSelectedAction}
                className={cn(
                  "flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-sm border px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:border-primary hover:bg-accent hover:text-accent-foreground focus-visible:border-primary focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none",
                  isSelectedAction ? "border-primary bg-accent" : "border-transparent bg-background",
                )}
                role="menuitemradio"
                type="button"
                onClick={(): void => {
                  onActionSelect(action.id);
                  setIsMenuOpen(false);
                }}
              >
                <span>{action.displayName}</span>
                <span aria-hidden="true" className={cn(isSelectedAction ? "opacity-100" : "opacity-0")}>
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function isNodeInsideContainer(container: HTMLDivElement | null, target: EventTarget | null): boolean {
  return container !== null && target instanceof Node && container.contains(target);
}
