import * as React from "react";

import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">): React.ReactElement {
  return (
    <textarea
      data-slot="textarea"
      data-testid="Textarea"
      className={cn(
        "block w-full resize-y rounded-sm border border-input bg-secondary px-1.5 py-1 text-lg text-foreground placeholder:text-faint focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none disabled:cursor-not-allowed disabled:border-dashed disabled:bg-transparent disabled:text-faint",
        className,
      )}
      {...props}
    />
  );
}
