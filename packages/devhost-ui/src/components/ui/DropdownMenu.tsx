import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "../../lib/utils";
import { CheckIcon, ChevronRightIcon } from "lucide-react";

type OmitKeys = "className" | "style";

type DropdownMenuContentProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Content>, OmitKeys> & {
  container?: HTMLElement | null;
  variant?: "default" | "wide";
};
type DropdownMenuItemProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Item>, OmitKeys> & {
  inset?: boolean;
  variant?: "default" | "destructive";
};
type DropdownMenuCheckboxItemProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>, OmitKeys> & {
  inset?: boolean;
};
type DropdownMenuRadioItemProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>, OmitKeys> & {
  inset?: boolean;
};
type DropdownMenuLabelProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Label>, OmitKeys> & {
  inset?: boolean;
};
type DropdownMenuSubTriggerProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>, OmitKeys> & {
  inset?: boolean;
};
type DropdownMenuSubContentProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>, OmitKeys>;
type DropdownMenuSeparatorProps = Omit<React.ComponentProps<typeof DropdownMenuPrimitive.Separator>, OmitKeys>;
type DropdownMenuShortcutProps = Omit<React.ComponentProps<"span">, OmitKeys>;

export function DropdownMenu({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

// @ts-unused-ignore planned for custom dropdown mounting
export function DropdownMenuPortal({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

export function DropdownMenuTrigger({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuContent({
  align = "start",
  container,
  sideOffset = 4,
  variant = "default",
  ...props
}: DropdownMenuContentProps) {
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        asChild
        {...props}
      >
        <div
          className={cn(
            "z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-(--radix-dropdown-menu-trigger-width) overflow-x-hidden overflow-y-auto rounded-md border border-edge bg-popover py-0.5 text-popover-foreground shadow-frame duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
            variant === "wide" ? "min-w-56" : "min-w-32",
          )}
        >
          {props.children}
        </div>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

export function DropdownMenuItem({ inset, variant = "default", ...props }: DropdownMenuItemProps) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      asChild
      {...props}
    >
      <div
        className={cn(
          "group/dropdown-menu-item relative flex h-6 cursor-default items-center gap-1.5 px-2 text-md outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:text-faint [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-inset:pl-6 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive data-[variant=destructive]:data-highlighted:text-destructive-foreground",
        )}
      >
        {props.children}
      </div>
    </DropdownMenuPrimitive.Item>
  );
}

export function DropdownMenuCheckboxItem({ children, checked, inset, ...props }: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      asChild
      checked={checked}
      {...props}
    >
      <div
        className={cn(
          "relative flex h-6 cursor-default items-center gap-1.5 pr-2 pl-6 text-md outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:text-faint [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        )}
      >
        <span
          className="pointer-events-none absolute left-2 flex items-center justify-center text-primary"
          data-slot="dropdown-menu-checkbox-item-indicator"
        >
          <DropdownMenuPrimitive.ItemIndicator>
            <CheckIcon />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
        {children}
      </div>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuRadioItem({ children, inset, ...props }: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuPrimitive.RadioItem data-slot="dropdown-menu-radio-item" data-inset={inset} asChild {...props}>
      <div
        className={cn(
          "relative flex h-6 cursor-default items-center gap-1.5 pr-2 pl-6 text-md outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:text-faint [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        )}
      >
        <span
          className="pointer-events-none absolute left-2 flex items-center justify-center text-primary"
          data-slot="dropdown-menu-radio-item-indicator"
        >
          <DropdownMenuPrimitive.ItemIndicator>
            <CheckIcon />
          </DropdownMenuPrimitive.ItemIndicator>
        </span>
        {children}
      </div>
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({ inset, ...props }: DropdownMenuLabelProps) {
  return (
    <DropdownMenuPrimitive.Label data-slot="dropdown-menu-label" data-inset={inset} asChild {...props}>
      <div className="px-2 py-0.5 text-sm text-muted-foreground data-inset:pl-6">{props.children}</div>
    </DropdownMenuPrimitive.Label>
  );
}

export function DropdownMenuSeparator({ ...props }: DropdownMenuSeparatorProps) {
  return (
    <DropdownMenuPrimitive.Separator data-slot="dropdown-menu-separator" asChild {...props}>
      <div className="my-0.5 h-px bg-border" />
    </DropdownMenuPrimitive.Separator>
  );
}

export function DropdownMenuShortcut({ ...props }: DropdownMenuShortcutProps) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      data-testid="DropdownMenuShortcut"
      className="ml-auto text-sm text-muted-foreground"
      {...props}
    />
  );
}

export function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

export function DropdownMenuSubTrigger({ inset, children, ...props }: DropdownMenuSubTriggerProps) {
  return (
    <DropdownMenuPrimitive.SubTrigger data-slot="dropdown-menu-sub-trigger" data-inset={inset} asChild {...props}>
      <div
        className={cn(
          "relative flex h-6 cursor-default items-center gap-1.5 px-2 text-md outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:text-faint [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-inset:pl-6 data-open:bg-accent",
        )}
      >
        {children}
        <span className="ml-auto">
          <ChevronRightIcon />
        </span>
      </div>
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({ ...props }: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuPrimitive.SubContent data-slot="dropdown-menu-sub-content" asChild {...props}>
      <div
        className={cn(
          "z-50 min-w-24 overflow-hidden rounded-md border border-edge bg-popover py-0.5 text-popover-foreground shadow-frame duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        )}
      >
        {props.children}
      </div>
    </DropdownMenuPrimitive.SubContent>
  );
}
