import { expect, userEvent, within, waitFor } from "storybook/test";

export async function openNativeBrowserConnectionPanel(canvasElement: HTMLElement): Promise<ReturnType<typeof within>> {
  const canvas = within(canvasElement);
  const trigger = canvas.getByRole("button", { name: "Native browser connection" });
  await userEvent.click(trigger);
  await waitFor(() => expect(trigger).toHaveAttribute("aria-expanded", "true"));
  return within(canvas.getByRole("region", { name: "Native browser connection" }));
}
