import { useCallback, useEffect, useRef, useState } from "react";
import type { ITabSnapshot } from "../types";

interface IScreenshotSelection {
  snapshot: ITabSnapshot | null;
  select: (snapshot: ITabSnapshot) => Promise<ITabSnapshot>;
  confirm: (snapshot: ITabSnapshot) => void;
  cancel: () => void;
}
interface IScreenshotSelectionRequest extends PromiseWithResolvers<ITabSnapshot> {
  snapshot: ITabSnapshot;
}

export function useScreenshotSelection(stream: MediaStream | undefined): IScreenshotSelection {
  const [selection, setSelection] = useState<IScreenshotSelectionRequest | null>(null);
  const pending = useRef<IScreenshotSelectionRequest | null>(null);
  const cancel = useCallback((): void => {
    pending.current?.reject(new Error("Screenshot sharing cancelled. Your draft and page context have been retained."));
    pending.current = null;
    setSelection(null);
  }, []);
  useEffect(() => () => cancel(), [cancel, stream]);
  const select = useCallback(
    (image: ITabSnapshot): Promise<ITabSnapshot> => {
      cancel();
      const request = Promise.withResolvers<ITabSnapshot>();
      const selection = { ...request, snapshot: image };
      pending.current = selection;
      setSelection(selection);
      return request.promise;
    },
    [cancel],
  );
  const confirm = useCallback(
    (image: ITabSnapshot): void => {
      if (pending.current !== selection) return;
      pending.current?.resolve(image);
      pending.current = null;
      setSelection(null);
    },
    [selection],
  );
  return { snapshot: selection?.snapshot ?? null, select, confirm, cancel };
}
