import type { IPromoFootageSlot } from "./types";

export async function readPromoFootageSlots(html: string): Promise<IPromoFootageSlot[]> {
  const slots: IPromoFootageSlot[] = [];
  const errors: string[] = [];
  await new HTMLRewriter()
    .on("video[data-footage]", {
      element: (element): void => {
        const id = element.getAttribute("id") ?? "";
        const sourceId = element.getAttribute("data-footage") ?? "";
        const outputPath = element.getAttribute("src") ?? "";
        const duration = Number(element.getAttribute("data-duration"));
        const readOffset = (name: string): number | undefined => {
          const offset = element.getAttribute(name);
          if (offset === null) return undefined;
          if (offset.trim() === "" || !Number.isFinite(Number(offset))) {
            errors.push(`Footage video ${id} has an invalid ${name}`);
          }
          return Number(offset);
        };
        if (!id || !sourceId) errors.push("A footage video needs an id and a data-footage source");
        if (!/^assets\/footage\/[a-z0-9-]+\.mp4$/.test(outputPath)) {
          errors.push(`Footage video ${id} must use a src under assets/footage/`);
        }
        if (!Number.isFinite(duration) || duration <= 0) {
          errors.push(`Footage video ${id} needs a positive data-duration`);
        }
        slots.push({
          id,
          sourceId,
          outputPath,
          duration,
          from: readOffset("data-footage-from") ?? 0,
          to: readOffset("data-footage-to"),
        });
      },
    })
    .transform(new Response(html))
    .text();
  const error = errors[0];
  if (error) throw new Error(error);
  return slots;
}
