import { ButtonLink, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@alexgorbatchev/shadcn";
import type { ReactElement } from "react";
import type { IRecoveryClient, StatusPageData } from "../types";
import { RecoveryPage } from "./RecoveryPage";
import { StatusFrame } from "./StatusFrame";
import { StackDirectoryPage } from "./StackDirectoryPage";
import { FilePage } from "./FilePage";
import { PreviewGallery } from "./PreviewGallery";

interface IStatusPageProps {
  data: StatusPageData;
  client: IRecoveryClient;
}

export function StatusPage({ data, client }: IStatusPageProps): ReactElement {
  if (data.kind === "recovery" && data.recovery)
    return <RecoveryPage initial={data.recovery} status={data.status} client={client} />;
  if (data.kind === "stacks") return <StackDirectoryPage stacks={data.stacks ?? []} query={data.query ?? ""} />;
  if (data.kind === "files" && data.files) return <FilePage data={data.files} />;
  if (data.kind === "previews") return <PreviewGallery />;
  return (
    <StatusFrame
      status={data.status}
      title={data.title}
      message={data.message}
      context={data.kind === "not-found" ? "routing" : "connection"}
    >
      {data.kind === "not-found" && (
        <section aria-labelledby="routes-title" className="flex flex-col gap-3">
          <h2 id="routes-title">Active hostnames</h2>
          {data.routes.length ? (
            <ul className="flex flex-col gap-3">
              {data.routes.map((route) => (
                <li key={route.url}>
                  <ButtonLink href={route.url} title={route.url} variant="outline" align="start" fullWidth truncate>
                    {route.host}
                  </ButtonLink>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No devhost hostnames are active right now.</EmptyTitle>
                <EmptyDescription>Start a stack and the available hostnames will appear here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
    </StatusFrame>
  );
}
