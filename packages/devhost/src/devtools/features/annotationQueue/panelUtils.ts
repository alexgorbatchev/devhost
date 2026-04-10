import type { IAnnotationQueueEntrySnapshot, IAnnotationQueueSnapshot } from "./types";

export interface IAnnotationQueueDraft {
  comment: string;
  entryId: string;
}

export function shouldRenderAnnotationQueuePanel(
  queues: IAnnotationQueueSnapshot[],
  errorMessage: string | null,
): boolean {
  return errorMessage !== null || queues.length > 0;
}

export function mergeAnnotationQueueDrafts(
  currentDrafts: IAnnotationQueueDraft[],
  queues: IAnnotationQueueSnapshot[],
): IAnnotationQueueDraft[] {
  const nextEntries: IAnnotationQueueEntrySnapshot[] = queues.flatMap(
    (queue: IAnnotationQueueSnapshot) => queue.entries,
  );

  return nextEntries.flatMap((entry: IAnnotationQueueEntrySnapshot): IAnnotationQueueDraft[] => {
    if (!isAnnotationQueueEntryEditable(entry)) {
      return [];
    }

    const existingDraft: IAnnotationQueueDraft | undefined = currentDrafts.find(
      (draft: IAnnotationQueueDraft): boolean => draft.entryId === entry.entryId,
    );

    return [
      {
        comment: existingDraft?.comment ?? entry.annotation.comment,
        entryId: entry.entryId,
      },
    ];
  });
}

export function isAnnotationQueueEntryEditable(entry: IAnnotationQueueEntrySnapshot): boolean {
  return entry.state === "queued" || entry.state === "paused-active";
}

export function isAnnotationQueueEntrySaveDisabled(
  entry: IAnnotationQueueEntrySnapshot,
  draftComment: string,
  isPending: boolean,
): boolean {
  return isPending || draftComment.trim().length === 0 || draftComment === entry.annotation.comment;
}

export function readAnnotationQueuePauseMessage(
  pauseReason: NonNullable<IAnnotationQueueSnapshot["pauseReason"]>,
): string {
  return pauseReason === "user-terminated"
    ? "Session terminated. Edit the head annotation or resume the queue."
    : "Session exited before the annotation finished. Resume to retry.";
}

export function readAnnotationQueueDraftComment(
  drafts: IAnnotationQueueDraft[],
  entry: IAnnotationQueueEntrySnapshot,
): string {
  return (
    drafts.find((draft: IAnnotationQueueDraft): boolean => draft.entryId === entry.entryId)?.comment ??
    entry.annotation.comment
  );
}

export function upsertAnnotationQueueDraft(
  currentDrafts: IAnnotationQueueDraft[],
  entryId: string,
  comment: string,
): IAnnotationQueueDraft[] {
  const existingDraft: IAnnotationQueueDraft | undefined = currentDrafts.find(
    (draft: IAnnotationQueueDraft): boolean => draft.entryId === entryId,
  );

  if (existingDraft === undefined) {
    return [...currentDrafts, { comment, entryId }];
  }

  return currentDrafts.map((draft: IAnnotationQueueDraft): IAnnotationQueueDraft => {
    return draft.entryId === entryId ? { comment, entryId } : draft;
  });
}
