import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@alexgorbatchev/shadcn";
import { Fragment, type ReactElement } from "react";
import type { FilePageData } from "../types";

interface IFileBreadcrumbsProps {
  breadcrumbs: FilePageData["breadcrumbs"];
}

export function FileBreadcrumbs({ breadcrumbs }: IFileBreadcrumbsProps): ReactElement {
  return (
    <Breadcrumb data-testid="FileBreadcrumbs" aria-label="Breadcrumb">
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => (
          <Fragment key={`${crumb.href}:${crumb.name}`}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href ? (
                <BreadcrumbLink href={crumb.href}>
                  <span className="break-all">{crumb.name}</span>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>
                  <span className="break-all">{crumb.name}</span>
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
