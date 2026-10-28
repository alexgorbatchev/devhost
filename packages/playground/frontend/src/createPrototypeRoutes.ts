import { PROTOTYPES, PROTOTYPE_STYLESHEETS } from "./constants";

export type PrototypeRoutes = Record<string, () => Response>;

// Handlers open the file per request, so an edited prototype shows on reload.
export function createPrototypeRoutes(designDirectory: URL): PrototypeRoutes {
  return Object.fromEntries(
    [...PROTOTYPES, ...PROTOTYPE_STYLESHEETS].map(({ path, file }) => [
      path,
      () => new Response(Bun.file(new URL(file, designDirectory))),
    ]),
  );
}
