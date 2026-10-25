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
  Separator,
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
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={id}>{stack.name}</h2>
          </CardTitle>
          <CardDescription>
            <p className="break-all">{stack.directory || stack.manifestPath}</p>
          </CardDescription>
          <CardAction>
            <Badge variant="outline">PID {stack.pid}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex min-w-0 flex-col gap-5">
            {stack.error && (
              <Alert variant="destructive">
                <AlertDescription>{stack.error}</AlertDescription>
              </Alert>
            )}
            {stack.services.map((service) => (
              <div key={service.name} className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">{service.name}</h3>
                  <Badge variant={service.status === "Running" ? "success" : "secondary"}>{service.status}</Badge>
                </div>
                {service.urls.map((url) => (
                  <ButtonLink key={url} href={url} title={url} variant="outline" align="start" fullWidth size="content">
                    <span className="min-w-0 flex-1 break-all text-left font-mono text-sm">{url}</span>
                    <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
                  </ButtonLink>
                ))}
                {!service.urls.length && <p className="text-sm text-muted-foreground">No HTTP URL</p>}
                {service.directory && <p className="text-xs text-muted-foreground break-all">{service.directory}</p>}
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <div className="flex min-w-0 w-full flex-col gap-4">
            <Separator />
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
                <div className="flex min-w-0 flex-col gap-4 pt-4">
                  <p className="text-xs text-muted-foreground break-all">
                    {stack.manifestPath ? `Root manifest: ${stack.manifestPath}` : "Manifest-free file or port session"}
                  </p>
                  {stack.startedAt && <p className="text-xs text-muted-foreground">Registered {stack.startedAt}</p>}
                  <p className="text-xs text-muted-foreground">
                    Current files on disk. Rejected edits can differ from the running configuration.
                  </p>
                  {stack.configs.map((config) => (
                    <Collapsible key={config.path}>
                      <CollapsibleTrigger
                        data-testid="StackDirectoryCard--file-toggle"
                        render={<Button variant="outline" size="content" align="start" fullWidth />}
                      >
                        <span className="min-w-0 flex-1 break-all text-left">
                          {config.kind} · {config.path}
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
          </div>
        </CardFooter>
      </Card>
    </section>
  );
}
