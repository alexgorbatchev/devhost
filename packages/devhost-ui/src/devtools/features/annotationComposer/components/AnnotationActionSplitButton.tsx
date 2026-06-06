import { useEffect, useId, useRef, useState, type JSX } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/DropdownMenu";
import { Kbd, KbdGroup } from "../../../../components/ui/Kbd";
import { buttonVariants } from "@/components/ui/constants";
import { cn } from "../../../../lib/utils";

import { Button, type IAnnotationAction } from "../../../shared";

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
  const portalContainer: HTMLDivElement | null = rootReference.current;

  useEffect(() => {
    if (!isActionMenuDisabled || !isMenuOpen) {
      return;
    }

    setIsMenuOpen(false);
  }, [isActionMenuDisabled, isMenuOpen]);

  return (
    <div ref={rootReference} className="relative inline-flex gap-px" data-testid="AnnotationActionSplitButton">
      <Button
        disabled={isRunDisabled}
        endEnhancer={
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </KbdGroup>
        }
        variant="primary"
        onClick={onRun}
      >
        {`Run ${selectedAction.displayName}`}
      </Button>
      <DropdownMenu modal={false} open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            aria-controls={isMenuOpen ? menuId : undefined}
            aria-label={`Select annotation action. Current: ${selectedAction.displayName}`}
            className={cn(buttonVariants({ size: "default", variant: "default" }), "px-2")}
            data-testid="AnnotationActionSplitButton--action-menu-toggle"
            disabled={isActionMenuDisabled}
            type="button"
          >
            ▾
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label="Annotation actions"
          variant="wide"
          container={portalContainer}
          id={menuId}
        >
          <DropdownMenuRadioGroup value={selectedAction.id}>
            {actions.map((action: IAnnotationAction) => {
              return (
                <DropdownMenuRadioItem
                  key={action.id}
                  value={action.id}
                  onSelect={(): void => {
                    onActionSelect(action.id);
                    setIsMenuOpen(false);
                  }}
                >
                  {action.displayName}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
