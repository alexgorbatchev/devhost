import {
  Badge,
  Button,
  ButtonLink,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Field,
  FieldLabel,
  Input,
} from "@alexgorbatchev/shadcn";
import { LayersIcon, RefreshCwIcon } from "lucide-react";
import { useId, type ReactElement } from "react";
import type { DirectoryStack } from "../types";
import { StackDirectoryCard } from "./StackDirectoryCard";

interface IStackDirectoryPageProps {
  stacks: DirectoryStack[];
  query: string;
}

export function StackDirectoryPage({ stacks, query }: IStackDirectoryPageProps): ReactElement {
  const id = useId();
  const urlCount = stacks.reduce(
    (count, stack) => count + stack.services.reduce((sum, service) => sum + service.urls.length, 0),
    0,
  );
  return (
    <main
      data-testid="StackDirectoryPage"
      className="mx-auto flex min-h-svh w-full max-w-6xl flex-col gap-8 p-4 py-8 sm:p-8 sm:py-12 wrap-anywhere"
    >
      <header className="flex flex-col gap-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LayersIcon size={20} aria-hidden="true" />
          <span>devhost / stack directory</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Running stacks</h1>
            <p className="text-sm text-muted-foreground">Your services, one place. Open a URL to get back to work.</p>
          </div>
          <div className="flex items-center gap-2" aria-label="Directory totals">
            <Badge variant="secondary">
              {stacks.length} {stacks.length === 1 ? "stack" : "stacks"}
            </Badge>
            <Badge variant="outline">
              {urlCount} {urlCount === 1 ? "URL" : "URLs"}
            </Badge>
          </div>
        </div>
        <form role="search" method="get" className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Field>
            <FieldLabel htmlFor={id}>Filter stacks</FieldLabel>
            <Input id={id} type="search" name="q" defaultValue={query} placeholder="Stack, service, URL, or path" />
          </Field>
          <Button type="submit" variant="outline">
            <RefreshCwIcon data-icon="inline-start" />
            Refresh / filter
          </Button>
          {query && (
            <ButtonLink href="?" variant="ghost">
              Clear filter
            </ButtonLink>
          )}
        </form>
        {query && (
          <p role="status" className="text-sm text-muted-foreground">
            Showing results for “{query}”
          </p>
        )}
      </header>
      {stacks.length ? (
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {stacks.map((stack) => (
            <StackDirectoryCard key={stack.pid} stack={stack} />
          ))}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{query ? "No matching stacks" : "No stacks running"}</EmptyTitle>
            <EmptyDescription>
              {query
                ? "Try another stack, service, URL, or path."
                : "Start a project with devhost start, then refresh this page."}
            </EmptyDescription>
          </EmptyHeader>
          {query && (
            <EmptyContent>
              <ButtonLink href="?" variant="outline">
                Show all stacks
              </ButtonLink>
            </EmptyContent>
          )}
        </Empty>
      )}
      <p className="text-xs text-muted-foreground">Refresh for the latest status. Configuration files are read-only.</p>
    </main>
  );
}
