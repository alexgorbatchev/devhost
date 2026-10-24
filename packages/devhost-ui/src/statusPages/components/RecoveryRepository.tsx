import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  NativeSelect,
  NativeSelectOption,
} from "@alexgorbatchev/shadcn";
import { useId, type ReactElement } from "react";
import type { IWorktreeSelection, RecoveryRepository as Repository } from "../types";
import { WorktreeOwner } from "./WorktreeOwner";

interface IRecoveryRepositoryProps {
  repository: Repository;
  isDisabled: boolean;
  onSelect: (selection: IWorktreeSelection) => Promise<void>;
}

export function RecoveryRepository({ repository, isDisabled, onSelect }: IRecoveryRepositoryProps): ReactElement {
  const id = useId();
  return (
    <section data-testid="RecoveryRepository" className="flex min-w-0 flex-col gap-4">
      <form
        data-repository={repository.id}
        onSubmit={(event) => {
          event.preventDefault();
          const path = new FormData(event.currentTarget).get("path");
          if (typeof path === "string") void onSelect({ repositoryId: repository.id, path });
        }}
      >
        <FieldSet disabled={isDisabled || repository.switching || !!repository.blockedReason}>
          <FieldLegend>{repository.name}</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={id}>Checkout</FieldLabel>
              <NativeSelect key={repository.selectedPath} id={id} name="path" defaultValue={repository.selectedPath}>
                {repository.worktrees.map((entry) => (
                  <NativeSelectOption key={entry.path} value={entry.path} disabled={!entry.available}>
                    {entry.branch || `Detached ${entry.head}`} · {entry.path}
                    {entry.reason ? ` · ${entry.reason}` : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {repository.blockedReason && <FieldDescription>{repository.blockedReason}</FieldDescription>}
              {repository.error && <FieldDescription role="status">{repository.error}</FieldDescription>}
            </Field>
            <Field orientation="horizontal">
              <Button type="submit" variant="outline">
                Switch worktree
              </Button>
            </Field>
          </FieldGroup>
        </FieldSet>
      </form>
      {repository.worktrees.flatMap((entry) =>
        entry.owners.map((owner) => (
          <WorktreeOwner
            key={`${entry.path}:${owner.id}`}
            owner={owner}
            path={entry.path}
            repositoryId={repository.id}
            isDisabled={isDisabled}
            onSelect={onSelect}
          />
        )),
      )}
    </section>
  );
}
