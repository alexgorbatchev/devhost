import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alexgorbatchev/shadcn";
import type { ReactElement, ReactNode } from "react";

interface IStatusFrameProps {
  status: number;
  title: string;
  message: string;
  context: string;
  children?: ReactNode;
}

export function StatusFrame({ status, title, message, context, children }: IStatusFrameProps): ReactElement {
  return (
    <main
      data-testid="StatusFrame"
      className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-4 p-4 sm:p-8 wrap-anywhere"
    >
      <p>devhost / {context}</p>
      <Card>
        <CardHeader>
          <Badge variant="secondary">{status}</Badge>
          <CardTitle>
            <h1 id="title">{title}</h1>
          </CardTitle>
          <CardDescription>
            <p id="message" role="status">
              {message}
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
