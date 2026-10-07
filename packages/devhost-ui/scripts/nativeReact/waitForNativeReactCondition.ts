import type { NativeReactCondition } from "./types";
import { nativeReactDeadlineMilliseconds } from "./constants";

export async function waitForNativeReactCondition(description: string, read: NativeReactCondition): Promise<void> {
  const deadline: number = Date.now() + nativeReactDeadlineMilliseconds;
  while (Date.now() < deadline) {
    if (await read()) return;
    await Bun.sleep(50);
  }
  throw new Error(`Native React readiness failed: ${description}`);
}
