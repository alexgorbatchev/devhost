import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alexgorbatchev/shadcn";
import { useState, type JSX } from "react";
import { cropTabSnapshot } from "../cropTabSnapshot";
import type { IScreenshotArea, ITabSnapshot } from "../types";
import { ScreenshotCropEditor } from "./ScreenshotCropEditor";

interface IScreenshotShareDialogProps {
  snapshot: ITabSnapshot;
  onShare: (snapshot: ITabSnapshot) => void;
  onCancel: () => void;
}

export function ScreenshotShareDialog({ snapshot, onShare, onCancel }: IScreenshotShareDialogProps): JSX.Element {
  const [area, setArea] = useState<IScreenshotArea | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shareArea = async (): Promise<void> => {
    if (area === null || isCropping) return;
    setIsCropping(true);
    setError(null);
    try {
      const cropped = await cropTabSnapshot(snapshot, area, document);
      onShare(cropped);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCropping(false);
    }
  };
  return (
    <div data-testid="ScreenshotShareDialog">
      <Dialog
        open
        onOpenChange={(isOpen) => {
          if (!isOpen) onCancel();
        }}
      >
        <DialogContent size="fullscreen">
          <DialogHeader>
            <DialogTitle>Share Screenshot</DialogTitle>
            <DialogDescription>Drag to select the area to share, or share the whole tab.</DialogDescription>
          </DialogHeader>
          <ScreenshotCropEditor snapshot={snapshot} area={area} onAreaChange={setArea} isDisabled={isCropping} />
          <p role="status" className="shrink-0 text-xs text-muted-foreground">
            {area ? `Selected area: ${area.width} × ${area.height}` : "No area selected."}
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="outline" disabled={isCropping} onClick={() => onShare(snapshot)}>
              Share Whole Tab
            </Button>
            <Button
              disabled={area === null || isCropping}
              onClick={() => {
                void shareArea();
              }}
            >
              {isCropping ? "Preparing Area…" : "Share Selected Area"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
