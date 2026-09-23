import { useEffect, useId, useRef, useState, type JSX } from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../../components/ui/DropdownMenu";
import { Kbd } from "../../../../components/ui/Kbd";
import { buttonVariants } from "@/components/ui/constants";

import { Button, type IAnnotationAction } from "../../../shared";

interface IAnnotationActionSplitButtonProps {
  actions: IAnnotationAction[];
  isActionMenuDisabled: boolean;
  isRunDisabled: boolean;
  runLabel: string;
  selectedAction: IAnnotationAction;
  onActionSelect: (actionId: string) => void;
  onRun: () => void;
}

export function AnnotationActionSplitButton({
  actions,
  isActionMenuDisabled,
  isRunDisabled,
  runLabel,
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
    <div
      ref={rootReference}
      className="relative inline-flex [&>button:first-child]:rounded-r-none"
      data-testid="AnnotationActionSplitButton"
    >
      <Button disabled={isRunDisabled} endEnhancer={<Kbd>⌘↵</Kbd>} variant="primary" onClick={onRun}>
        {runLabel}
      </Button>
      <DropdownMenu modal={false} open={isMenuOpen} onOpenChange={setIsMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            aria-controls={isMenuOpen ? menuId : undefined}
            aria-label={`Select annotation action. Current: ${selectedAction.displayName}`}
            className={buttonVariants({
              className: "rounded-l-none border-l border-l-primary-foreground/35",
              shape: "icon",
              variant: "primary",
            })}
            data-testid="AnnotationActionSplitButton--action-menu-toggle"
            disabled={isActionMenuDisabled}
            type="button"
          >
            <ChevronDownIcon aria-hidden="true" />
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
                  <span className="flex-1">{action.displayName}</span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    {action.kind}
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
