import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ICursorPayload {
  locator?: string | null;
}

const testsDirectoryPath: string = dirname(fileURLToPath(import.meta.url));
const pluginRootPath: string = dirname(testsDirectoryPath);
const fixturePath: string = join(testsDirectoryPath, "fixtures", "nested-elements.tsx");
const scriptPath: string = join(testsDirectoryPath, "cursor-resolution.vim");
const expectedPayloads: ICursorPayload[] = [
  { locator: "tests/fixtures/nested-elements.tsx:3:5" },
  { locator: "tests/fixtures/nested-elements.tsx:5:9" },
  { locator: "tests/fixtures/nested-elements.tsx:4:7" },
  { locator: null },
];
const receivedPayloads: ICursorPayload[] = [];
let requestCount: number = 0;

const server = Bun.serve({
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("not found", { status: 404 });
    }

    const token: string | null = request.headers.get("x-devhost-control-token");
    if (token !== "test-token") {
      return new Response("forbidden", { status: 403 });
    }

    const payload: unknown = await request.json();
    if (!isCursorPayload(payload)) {
      return new Response("bad request", { status: 400 });
    }

    requestCount += 1;
    receivedPayloads.push(payload);
    return Response.json({ success: true });
  },
  port: 0,
});

const timeout = setTimeout((): void => {
  server.stop(true);
  console.error(`Timed out waiting for Neovim test process after ${requestCount} cursor request(s).`);
  process.exit(1);
}, 10000);

const nvimProcess = Bun.spawn(["nvim", "--headless", "-n", fixturePath, "-S", scriptPath], {
  env: {
    ...process.env,
    DEVHOST_CONTROL_TOKEN: "test-token",
    DEVHOST_PROJECT_ROOT: pluginRootPath,
    DEVHOST_REACT_HIGHLIGHT_PLUGIN_ROOT: pluginRootPath,
    DEVHOST_REACT_HIGHLIGHT_URL: `http://127.0.0.1:${server.port}/cursor`,
    DEVHOST_STACK_NAME: "nvim-test",
  },
  stderr: "pipe",
  stdout: "pipe",
});

const exitCode: number = await nvimProcess.exited;
clearTimeout(timeout);
server.stop(true);

const stderr: string = await new Response(nvimProcess.stderr).text();
if (exitCode !== 0) {
  console.error(stderr);
  process.exit(exitCode);
}

if (!arePayloadsEqual(receivedPayloads, expectedPayloads)) {
  console.error("Unexpected React Highlight cursor payloads.");
  console.error(`Expected: ${JSON.stringify(expectedPayloads)}`);
  console.error(`Received: ${JSON.stringify(receivedPayloads)}`);
  process.exit(1);
}

console.log(`React Highlight Neovim tests passed (${receivedPayloads.length} cursor payloads).`);

function isCursorPayload(value: unknown): value is ICursorPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const locator: unknown = Reflect.get(value, "locator");
  return typeof locator === "string" || locator === null;
}

function arePayloadsEqual(actual: ICursorPayload[], expected: ICursorPayload[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
