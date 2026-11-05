import { tmpdir } from "node:os";

// The test runner owns TMPDIR; each fixture owns a unique child, with no shared scratch parent.
export const E2E_TEMPORARY_PATH: string = tmpdir();
