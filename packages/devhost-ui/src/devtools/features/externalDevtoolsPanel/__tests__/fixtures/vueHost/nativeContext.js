import { getDevframeClientContext } from "@devframes/hub/client";

// Test-owned measurements read unchanged native objects and never manufacture a hook or host context.
window.nativeVueFixture = {
  readContext: getDevframeClientContext,
  replaceDock() {
    const Dock = customElements.get("devframes-dock-embedded");
    const dock = document.querySelector("devframes-dock-embedded");
    if (!Dock || !dock) throw new Error("The native dock must be mounted before replacement");
    dock.replaceWith(new Dock({ context: getDevframeClientContext() }));
  },
  readVueEntry() {
    const entry = getDevframeClientContext()?.docks.entries.find((entry) => entry.id === "vue-devtools");
    if (entry?.type !== "iframe") throw new Error("The genuine Vue iframe entry is not registered");
    return entry;
  },
};
