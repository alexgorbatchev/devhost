import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@alexgorbatchev/shadcn";
import { ArrowUpRightIcon, ChevronDownIcon, FileCodeIcon } from "lucide-react";
import { useId, type ReactElement } from "react";
import type { DirectoryStack } from "../types";

interface IStackDirectoryCardProps {
  stack: DirectoryStack;
}

export function StackDirectoryCard({ stack }: IStackDirectoryCardProps): ReactElement {
  const id = useId();
  return (
    <section data-testid="StackDirectoryCard" aria-labelledby={id}>
      <Card size="sm" density="compact">
        <CardHeader>
          <CardTitle>
            <h2 id={id}>{stack.name}</h2>
          </CardTitle>
          <CardDescription>
            <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 text-xs">
              <dt>Directory</dt>
              <dd className="break-all">{stack.directory || stack.manifestPath || "—"}</dd>
            </dl>
          </CardDescription>
          <CardAction>
            <Badge variant="outline">PID {stack.pid}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex min-w-0 flex-col gap-2">
            {stack.error && (
              <Alert variant="destructive">
                <AlertDescription>{stack.error}</AlertDescription>
              </Alert>
            )}
            {!!stack.services.length && (
              <Table layout="fixed" density="compact" aria-label={`${stack.name} services`}>
                <colgroup>
                  <col className="w-28 sm:w-44" />
                  <col className="hidden w-28 sm:table-column" />
                  <col />
                </colgroup>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Service</TableHead>
                    <TableHead scope="col" visibleFrom="sm">
                      Status
                    </TableHead>
                    <TableHead scope="col">URLs / directory</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stack.services.map((service) => (
                    <TableRow key={service.name}>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1 py-1">
                          <h3 className="max-w-full text-sm font-medium whitespace-normal break-all">{service.name}</h3>
                          <p className="text-xs text-muted-foreground whitespace-normal sm:hidden">{service.status}</p>
                        </div>
                      </TableCell>
                      <TableCell visibleFrom="sm">
                        <Badge variant={service.status === "Running" ? "success" : "secondary"}>{service.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-0 flex-col items-start gap-1 py-1">
                          {service.urls.map((url) => (
                            <ButtonLink
                              key={url}
                              href={url}
                              title={url}
                              variant="link"
                              align="start"
                              fullWidth
                              size="inline"
                            >
                              <span className="min-w-0 flex-1 break-all text-left font-mono text-sm whitespace-normal">
                                {url}
                              </span>
                              <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
                            </ButtonLink>
                          ))}
                          {!service.urls.length && (
                            <p className="text-sm text-muted-foreground whitespace-normal">No HTTP URL</p>
                          )}
                          {service.directory && (
                            <p className="text-xs text-muted-foreground whitespace-normal break-all">
                              {service.directory}
                            </p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <div className="min-w-0 w-full">
            <Collapsible>
              <CollapsibleTrigger
                data-testid="StackDirectoryCard--configuration-toggle"
                render={<Button variant="ghost" size="sm" />}
              >
                <FileCodeIcon data-icon="inline-start" />
                Configuration · {stack.configs.length} files
                <ChevronDownIcon data-icon="inline-end" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex min-w-0 flex-col gap-2 pt-2">
                  <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <dt>Root manifest</dt>
                    <dd className="break-all">{stack.manifestPath || "Manifest-free file or port session"}</dd>
                    {stack.startedAt && (
                      <>
                        <dt>Registered</dt>
                        <dd className="break-all">{stack.startedAt}</dd>
                      </>
                    )}
                  </dl>
                  {stack.configs.map((config) => (
                    <Collapsible key={config.path}>
                      <CollapsibleTrigger
                        data-testid="StackDirectoryCard--file-toggle"
                        render={<Button variant="outline" size="content" align="start" fullWidth />}
                      >
                        <span className="grid min-w-0 flex-1 grid-cols-[5rem_minmax(0,1fr)] gap-x-3 text-left">
                          <span>{config.kind} ·</span>
                          <span className="break-all">{config.path}</span>
                        </span>
                        <ChevronDownIcon data-icon="inline-end" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="min-w-0 pt-3">
                          {config.error ? (
                            <Alert>
                              <AlertDescription>{config.error}</AlertDescription>
                            </Alert>
                          ) : (
                            <pre className="max-h-96 max-w-full overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed">
                              <code>{config.content}</code>
                            </pre>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
            <p className="text-xs text-muted-foreground">
              Current files on disk. Rejected edits can differ from the running configuration.
            </p>
          </div>
        </CardFooter>
      </Card>
    </section>
  );
}
