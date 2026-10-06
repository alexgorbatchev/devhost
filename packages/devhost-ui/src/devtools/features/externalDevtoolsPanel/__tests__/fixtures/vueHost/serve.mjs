import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";

let nativeContext;
let removedEntry;
const nativeDisposers = [];
const fixturePlugin = {
  name: "native-vue-host-fixture",
  devtools: {
    async setup(context) {
      nativeContext = context;
      nativeDisposers.push(
        context.docks.events.on("docks:entry:updated", (entry) =>
          console.log("FIXTURE_DOCK_EVENT", entry.id, entry.title),
        ),
      );
      const state = await context.rpc.sharedState.get("devframe:docks");
      nativeDisposers.push(
        state.on("updated", (entries) =>
          console.log(
            "FIXTURE_DOCK_STATE",
            JSON.stringify(entries.map(({ id, title, badge }) => ({ id, title, badge }))),
          ),
        ),
      );
    },
  },
};
const server = await createServer({
  configFile: false,
  root: import.meta.dirname,
  base: process.env.NATIVE_VUE_BASE ?? "/",
  plugins: [vue(), vueDevTools(), fixturePlugin],
  devtools: { apply: "serve", port: 0, embeddedVisibility: process.env.NATIVE_VUE_VISIBILITY ?? "normal" },
  server: { host: "127.0.0.1", port: 0, strictPort: true },
});
await server.listen();
// Test-owned driver applies real public host operations to the unchanged native registry.
const control = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const { action } = await request.json();
    const entry = nativeContext.docks.views.get("vue-devtools");
    switch (action) {
      case "replace":
        nativeContext.docks.register({ ...entry, title: "Server-owned Vue inspector", badge: "Live" }, true);
        break;
      case "remove-field": {
        const replacement = { ...entry };
        delete replacement.badge;
        nativeContext.docks.update(replacement);
        break;
      }
      case "remove": {
        removedEntry = entry;
        nativeContext.docks.views.delete("vue-devtools");
        // The public host map has no remove method; a real update publishes its current values.
        const other = nativeContext.docks.values().find((candidate) => candidate.id !== "vue-devtools");
        nativeContext.docks.update(other);
        break;
      }
      case "restore":
        nativeContext.docks.register(removedEntry, true);
        break;
      default:
        return new Response(null, { status: 400 });
    }
    return Response.json(nativeContext.docks.values());
  },
});
console.log(`FIXTURE_CONTROL ${control.url}`);
console.log(`FIXTURE_READY ${server.resolvedUrls.local[0]}`);
process.on("SIGTERM", async () => {
  for (const dispose of nativeDisposers) dispose();
  await control.stop(true);
  await server.close();
  process.exit(0);
});
