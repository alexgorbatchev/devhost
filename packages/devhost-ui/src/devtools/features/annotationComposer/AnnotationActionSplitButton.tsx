import type { CSSObject } from "@emotion/css/create-instance";
import { useEffect, useId, useRef, useState, type JSX } from "react";

import { Button, css, type IAnnotationAction, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";

interface IAnnotationActionSplitButtonProps {
  actions: IAnnotationAction[];
  isActionMenuDisabled: boolean;
  isRunDisabled: boolean;
  selectedAction: IAnnotationAction;
  onActionSelect: (actionId: string) => void;
  onRun: () => void;
}

const shortcutBadgeHoverStyle: CSSObject = {
  color: "rgba(255, 255, 255, 1)",
};

const actionButtonMutedForeground: string = "rgba(255, 255, 255, 0.6)";
const actionButtonShortcutBackground: string = "rgba(255, 255, 255, 0.1)";
const actionButtonSubmitForeground: string = "rgba(255, 255, 255, 1)";
const actionButtonHoverRing: string = "rgba(255, 255, 255, 0.22)";

export function AnnotationActionSplitButton({
  actions,
  isActionMenuDisabled,
  isRunDisabled,
  selectedAction,
  onActionSelect,
  onRun,
}: IAnnotationActionSplitButtonProps): JSX.Element {
  const theme = useDevtoolsTheme();
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const rootReference = useRef<HTMLDivElement | null>(null);
  const menuId: string = useId();
  const rootClassName: string = css(groupStyle);
  const menuClassName: string = css(createMenuStyle(theme));

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
    <div ref={rootReference} className={rootClassName} data-testid="AnnotationActionSplitButton">
      <Button
        disabled={isRunDisabled}
        endEnhancer="⌘ ↵"
        endEnhancerStyle={createShortcutBadgeStyle(theme)}
        endEnhancerStyleHover={shortcutBadgeHoverStyle}
        style={createRunButtonStyle(theme)}
        styleHover={createActionButtonHoverStyle(theme)}
        variant="primary"
        onClick={onRun}
      >
        {`Run ${selectedAction.displayName}`}
      </Button>
      <Button
        ariaControls={isMenuOpen ? menuId : undefined}
        ariaExpanded={isMenuOpen}
        ariaHaspopup="menu"
        ariaLabel={`Select annotation action. Current: ${selectedAction.displayName}`}
        disabled={isActionMenuDisabled}
        style={createToggleButtonStyle(theme, isMenuOpen)}
        styleHover={createActionButtonHoverStyle(theme)}
        testId="AnnotationActionSplitButton--action-menu-toggle"
        variant="primary"
        onClick={(): void => {
          setIsMenuOpen((currentValue: boolean): boolean => !currentValue);
        }}
      >
        ▾
      </Button>
      {isMenuOpen ? (
        <div aria-label="Annotation actions" className={menuClassName} id={menuId} role="menu">
          {actions.map((action: IAnnotationAction) => {
            const isSelectedAction: boolean = action.id === selectedAction.id;
            const menuItemClassName: string = css(createMenuItemStyle(theme, isSelectedAction));
            const indicatorClassName: string = css(createSelectionIndicatorStyle(theme, isSelectedAction));

            return (
              <button
                key={action.id}
                aria-checked={isSelectedAction}
                className={menuItemClassName}
                role="menuitemradio"
                type="button"
                onClick={(): void => {
                  onActionSelect(action.id);
                  setIsMenuOpen(false);
                }}
              >
                <span>{action.displayName}</span>
                <span aria-hidden="true" className={indicatorClassName}>
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

const groupStyle: CSSObject = {
  display: "inline-flex",
  position: "relative",
};

const menuItemInteractiveSelector: string = "&:is(:hover, :focus-visible)";

function createMenuStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    boxShadow: theme.shadows.popup,
    display: "grid",
    gap: theme.spacing.xxs,
    minWidth: "220px",
    padding: theme.spacing.xxs,
    position: "absolute",
    right: 0,
    top: `calc(100% + ${theme.spacing.xxs})`,
    zIndex: Number(theme.zIndices.floating) + 1,
  };
}

function createMenuItemStyle(theme: IDevtoolsTheme, isSelectedAction: boolean): CSSObject {
  return {
    [menuItemInteractiveSelector]: {
      background: theme.colors.selectionBackground,
      borderColor: theme.colors.selectionBorder,
      color: actionButtonSubmitForeground,
    },
    alignItems: "center",
    background: isSelectedAction ? theme.colors.selectionBackground : theme.colors.background,
    border: `1px solid ${isSelectedAction ? theme.colors.selectionBorder : "transparent"}`,
    borderRadius: theme.radii.sm,
    color: theme.colors.foreground,
    cursor: "pointer",
    display: "flex",
    fontFamily: theme.fontFamilies.body,
    fontSize: theme.fontSizes.sm,
    gap: theme.spacing.xs,
    justifyContent: "space-between",
    minHeight: "36px",
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
    textAlign: "left",
    width: "100%",
  };
}

function createSelectionIndicatorStyle(theme: IDevtoolsTheme, isSelectedAction: boolean): CSSObject {
  return {
    color: isSelectedAction ? actionButtonSubmitForeground : theme.colors.mutedForeground,
    opacity: isSelectedAction ? 1 : 0,
  };
}

function createActionButtonHoverStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${actionButtonSubmitForeground}`,
    boxShadow: `0 0 0 1px ${actionButtonHoverRing}, ${theme.shadows.floating}`,
    color: actionButtonSubmitForeground,
  };
}

function createShortcutBadgeStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: actionButtonShortcutBackground,
    border: "none",
    borderRadius: theme.radii.sm,
    boxSizing: "border-box",
    color: actionButtonMutedForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: "80%",
    lineHeight: 1.6,
    minWidth: "32px",
    padding: `0 ${theme.spacing.xs}`,
  };
}

function createRunButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: theme.colors.selectionBackground,
    border: `1px solid ${theme.colors.selectionBorder}`,
    borderBottomRightRadius: 0,
    borderTopRightRadius: 0,
    boxShadow: theme.shadows.floating,
    color: actionButtonSubmitForeground,
  };
}

function createToggleButtonStyle(theme: IDevtoolsTheme, isMenuOpen: boolean): CSSObject {
  return {
    background: theme.colors.selectionBackground,
    border: `1px solid ${theme.colors.selectionBorder}`,
    borderBottomLeftRadius: 0,
    borderTopLeftRadius: 0,
    borderLeftColor: isMenuOpen ? actionButtonSubmitForeground : actionButtonHoverRing,
    boxShadow: theme.shadows.floating,
    color: actionButtonSubmitForeground,
    marginLeft: "-1px",
    minWidth: "40px",
    paddingInline: theme.spacing.xs,
  };
}

function isNodeInsideContainer(container: HTMLDivElement | null, target: EventTarget | null): boolean {
  return container !== null && target instanceof Node && container.contains(target);
}
