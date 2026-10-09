import { join } from "node:path";
import { readPromoFootageSlots } from "./readPromoFootageSlots";
import type { IPromoFootageRequest } from "./types";

export async function readPromoFootageRequests(projectPath: string): Promise<IPromoFootageRequest[]> {
  const files = await Array.fromAsync(new Bun.Glob("**/*.html").scan({ cwd: projectPath, onlyFiles: true }));
  const requests: IPromoFootageRequest[] = [];
  for (const file of files.sort()) {
    for (const slot of await readPromoFootageSlots(await Bun.file(join(projectPath, file)).text())) {
      requests.push({ file, slot });
    }
  }
  return requests;
}
