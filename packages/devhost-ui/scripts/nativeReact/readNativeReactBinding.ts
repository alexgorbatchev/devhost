import { z } from "zod";
import type { Page } from "playwright";
import type { INativeBrowserBinding } from "../../src/devtools/shared/nativeBrowser/types";

const bindingSchema = z.object({
  instanceId: z.string().regex(/^[a-f0-9]{32}$/),
  documentId: z.string().regex(/^[a-f0-9]{32}$/),
  href: z.string().url(),
});

export async function readNativeReactBinding(page: Page): Promise<INativeBrowserBinding> {
  const value: unknown = await page.evaluate(() => {
    const root = document
      .getElementById("devhost-devtools-host")
      ?.shadowRoot?.querySelector("[data-devhost-native-document]");
    return {
      instanceId: root?.getAttribute("data-devhost-native-instance"),
      documentId: root?.getAttribute("data-devhost-native-document"),
      href: location.href,
    };
  });
  return bindingSchema.parse(value);
}
