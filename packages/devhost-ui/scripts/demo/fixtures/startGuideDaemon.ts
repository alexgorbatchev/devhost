import { spawn } from "node:child_process";
import { openSync } from "node:fs";

// Starts the guide's service as a daemon: in a session of its own, outliving this start command. `detached` makes
// the child call setsid(), on macOS as on Linux.
export function startGuideDaemon(): void {
  const child = spawn("bun", ["serveGuideService.ts"], {
    detached: true,
    stdio: ["ignore", openSync("daemon.log", "a"), openSync("daemon.stderr.log", "a")],
  });
  child.unref();
}

if (import.meta.main) startGuideDaemon();
