import { ButtonLink, Card, CardContent, CardHeader, CardTitle } from "@alexgorbatchev/shadcn";
import { ArrowUpRightIcon } from "lucide-react";
import type { ReactElement } from "react";

const groups = [
  {
    title: "Routing",
    links: [
      { href: "route-not-found", name: "404 · Active hostname list" },
      { href: "route-not-found-empty", name: "404 · No active hostnames" },
      { href: "backend-unavailable", name: "502 · Unavailable backend" },
    ],
  },
  {
    title: "Startup and recovery",
    links: [
      { href: "starting", name: "Starting service" },
      { href: "failed", name: "Exited service" },
      { href: "external", name: "External service · Restart disabled" },
      { href: "404", name: "404 · Missing application page" },
      { href: "500", name: "500 · Internal server error" },
      { href: "502", name: "502 · Bad gateway" },
      { href: "503", name: "503 · Service unavailable" },
      { href: "504", name: "504 · Gateway timeout" },
      { href: "worktrees", name: "Worktree selection" },
    ],
  },
  {
    title: "Files",
    links: [
      { href: "files/", name: "Directory listing" },
      { href: "files/notes.md", name: "Markdown · Rendered and source views" },
    ],
  },
];

export function PreviewGallery(): ReactElement {
  return (
    <main
      data-testid="PreviewGallery"
      className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-8 p-4 py-8 sm:p-8 sm:py-12 wrap-anywhere"
    >
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">devhost / development</p>
        <h1 className="text-3xl font-semibold tracking-tight">Standalone page previews</h1>
        <p className="text-sm text-muted-foreground">
          These examples use the real page components with sample data. Preview actions cannot change running services.
          Error pages retain their HTTP status.
        </p>
      </header>
      <div className="grid min-w-0 items-start gap-6 md:grid-cols-2">
        {groups.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle>
                <h2>{group.title}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex min-w-0 flex-col gap-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <ButtonLink href={link.href} variant="outline" size="content" align="start" fullWidth>
                      <span className="min-w-0 flex-1 text-left">{link.name}</span>
                      <ArrowUpRightIcon data-icon="inline-end" />
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Use your browser’s light or dark preference to inspect both themes. Restart just run after editing page
        components or styles to rebuild the embedded pages.
      </p>
    </main>
  );
}
