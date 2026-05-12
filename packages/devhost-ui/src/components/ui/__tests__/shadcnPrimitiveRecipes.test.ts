import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { badgeVariants } from "../badgeVariants";
import { buttonVariants } from "../buttonVariants";

describe("shadcn primitive recipes", () => {
  test("uses the requested root radius token", () => {
    const devtoolsCss: string = readFileSync(join(import.meta.dir, "../../../devtools/shared/devtools.css"), "utf8");

    expect(devtoolsCss).toContain("--radius: 0.5em;");
  });

  test("uses shadcn button and badge variant recipes", () => {
    const outlineSmallButtonClassName: string = buttonVariants({ size: "sm", variant: "outline" });

    expect(outlineSmallButtonClassName).toContain("rounded-[min(var(--radius-md),12px)]");
    expect(outlineSmallButtonClassName).toContain("dark:border-input");
    expect(badgeVariants({ variant: "destructive" })).toContain("rounded-4xl");
  });

  test("uses shadcn card and textarea base recipes", () => {
    const uiDirectoryPath: string = join(import.meta.dir, "..");
    const cardSource: string = readFileSync(join(uiDirectoryPath, "card.tsx"), "utf8");
    const textareaSource: string = readFileSync(join(uiDirectoryPath, "textarea.tsx"), "utf8");

    expect(cardSource).toContain("ring-1 ring-foreground/10");
    expect(cardSource).toContain("group-data-[size=sm]/card:px-3");
    expect(textareaSource).toContain("dark:bg-input/30");
  });
});
