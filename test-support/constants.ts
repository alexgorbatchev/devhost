import { tmpdir } from "node:os";
import { resolve } from "node:path";

// End-to-end artifacts stay outside the checkout under the test policy exception.
export const E2E_TEMPORARY_PATH: string = resolve(tmpdir(), "devhost-e2e");
