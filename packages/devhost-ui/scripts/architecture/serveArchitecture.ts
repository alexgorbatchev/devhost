import { createArchitectureHandler } from "./createArchitectureHandler";

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 0),
  fetch: createArchitectureHandler(`${import.meta.dir}/../../../../docs/internal/architecture`),
});
