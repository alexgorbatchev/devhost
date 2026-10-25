import {
  Button,
  ButtonLink,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Separator,
} from "@alexgorbatchev/shadcn";
import { ArrowUpRightIcon, CodeIcon } from "lucide-react";
import type { ReactElement } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMarkdownSource } from "../hooks/useMarkdownSource";
import type { FilePageData } from "../types";
import { FileBreadcrumbs } from "./FileBreadcrumbs";

interface IFilePageProps {
  data: FilePageData;
}

export function FilePage({ data }: IFilePageProps): ReactElement {
  const { isSource, toggleSource } = useMarkdownSource();
  return (
    <main
      data-testid="FilePage"
      className="mx-auto flex min-h-svh w-full max-w-5xl flex-col gap-6 p-4 py-8 sm:p-8 sm:py-12 wrap-anywhere"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <FileBreadcrumbs breadcrumbs={data.breadcrumbs} />
        {data.markdown && (
          <Button id="toggle-source" variant="outline" onClick={toggleSource} aria-controls="source rendered">
            <CodeIcon data-icon="inline-start" />
            {isSource ? "Show rendered" : "Show source"}
          </Button>
        )}
      </header>
      <Separator />
      {data.markdown ? (
        <article className="markdown-body min-w-0">
          <div id="rendered" hidden={isSource}>
            <Markdown remarkPlugins={[remarkGfm]} skipHtml>
              {data.source}
            </Markdown>
          </div>
          <pre
            id="source"
            hidden={!isSource}
            className="max-w-full overflow-auto rounded-md bg-muted p-4 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere"
          >
            <code>{data.source}</code>
          </pre>
        </article>
      ) : (
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby="listing-title">
          <h1 id="listing-title" className="text-xl font-semibold">
            Directory listing
          </h1>
          {data.entries.length ? (
            <ul className="flex min-w-0 flex-col gap-3">
              {data.entries.map((entry) => (
                <li key={entry.href}>
                  <ButtonLink href={entry.href} variant="outline" fullWidth align="start" size="content">
                    <span className="min-w-0 flex-1 break-all text-left">{entry.name}</span>
                    <ArrowUpRightIcon data-icon="inline-end" />
                  </ButtonLink>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>This directory is empty</EmptyTitle>
                <EmptyDescription>Files added here appear after a refresh.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
    </main>
  );
}
