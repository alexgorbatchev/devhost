import { join } from "node:path";
import type { IDemoRuntime } from "./types";

export async function createPiDemoFiles(runtime: IDemoRuntime): Promise<void> {
  await Bun.write(
    join(runtime.directoryPath, "pi-demo-instructions.md"),
    [
      "This is an isolated recording fixture. Apply the supplied annotation using the read and edit tools.",
      `The only editable file is ${runtime.env.DEVHOST_DEMO_EDIT_FILE}. Use this absolute path for both read and edit.`,
      "Read that file, change only the requested visible text, and preserve JSX structure, imports, classes and attributes.",
      "Do not edit any other file, run commands, install dependencies, or commit. The recording will verify and undo the edit.",
      "After editing, reply with one sentence describing the change.",
    ].join("\n") + "\n",
  );
  await Bun.write(
    join(runtime.directoryPath, "pi-demo-guard.js"),
    [
      "const { resolve } = require('node:path');",
      "module.exports = function (pi) {",
      "  pi.on('tool_call', (event) => {",
      "    if (event.toolName === 'read') return;",
      "    if (event.toolName === 'edit' && typeof event.input.path === 'string' &&",
      "        resolve(process.cwd(), event.input.path) === process.env.DEVHOST_DEMO_EDIT_FILE) return;",
      "    return { block: true, reason: 'Only the recorded playground component may be edited.' };",
      "  });",
      "};",
    ].join("\n") + "\n",
  );
}
