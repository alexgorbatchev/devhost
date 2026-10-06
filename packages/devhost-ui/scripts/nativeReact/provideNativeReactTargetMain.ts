import { z } from "zod";
import { provideNativeReactTarget } from "./provideNativeReactTarget";
const configuration = z
  .object({ endpoint: z.string().url(), targetId: z.string().min(1) })
  .parse(JSON.parse(z.string().min(1).parse(Bun.env.DEVHOST_NATIVE_REACT_TARGET)));
await provideNativeReactTarget(configuration.endpoint, configuration.targetId);
