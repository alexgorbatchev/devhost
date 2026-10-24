import {
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@alexgorbatchev/shadcn";
import type { ReactElement } from "react";
import type { IWorktreeSelection, RecoveryOwner } from "../types";

interface IWorktreeOwnerProps {
  owner: RecoveryOwner;
  repositoryId: string;
  path: string;
  isDisabled: boolean;
  onSelect: (selection: IWorktreeSelection) => Promise<void>;
}

export function WorktreeOwner({ owner, repositoryId, path, isDisabled, onSelect }: IWorktreeOwnerProps): ReactElement {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>
          In use by {owner.name} · PID {owner.pid}
        </CardTitle>
        <CardDescription>
          {path}
          <br />
          {owner.manifestPath}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {owner.urls.length ? (
            owner.urls.map((url) => (
              <ButtonLink
                key={url}
                href={url}
                title={url}
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                align="start"
                fullWidth
                truncate
              >
                Open stack · {url}
              </ButtonLink>
            ))
          ) : (
            <p>This stack has no routed page.</p>
          )}
          <p>Stop all services in this stack to free the checkout.</p>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          variant="outline"
          disabled={isDisabled}
          data-stop-owner={owner.id}
          onClick={() => void onSelect({ repositoryId, path, stopOwnerId: owner.id })}
        >
          Stop stack
        </Button>
      </CardFooter>
    </Card>
  );
}
