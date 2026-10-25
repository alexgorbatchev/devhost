import { getScreenshotArea } from "./getScreenshotArea";
import type { IScreenshotArea, ITabSnapshot } from "./types";

export async function cropTabSnapshot(
  snapshot: ITabSnapshot,
  area: IScreenshotArea,
  document: Document,
): Promise<ITabSnapshot> {
  if (area.width <= 0 || area.height <= 0) throw new Error("Select an area inside the screenshot.");
  const crop = getScreenshotArea(area, { x: area.x + area.width, y: area.y + area.height }, snapshot);
  if (crop === null) throw new Error("Select an area inside the screenshot.");
  const image = document.createElement("img");
  image.src = snapshot.dataUrl;
  try {
    await image.decode();
    if (image.naturalWidth !== snapshot.width || image.naturalHeight !== snapshot.height)
      throw new Error("The screenshot dimensions do not match its image.");
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("The browser could not crop the screenshot.");
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: crop.width,
      height: crop.height,
      crop: { ...crop, sourceWidth: snapshot.width, sourceHeight: snapshot.height },
    };
  } finally {
    image.removeAttribute("src");
  }
}
