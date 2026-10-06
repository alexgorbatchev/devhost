import { z } from "zod";
import { adaptNativeReactCaddyfile } from "./adaptNativeReactCaddyfile";
const configuration = z
  .object({ path: z.string().min(1), originalPath: z.string().min(1), adminAddress: z.string().min(1) })
  .parse(JSON.parse(z.string().min(1).parse(Bun.env.DEVHOST_NATIVE_REACT_CADDYFILE)));
await adaptNativeReactCaddyfile(configuration.path, configuration.originalPath, configuration.adminAddress);
