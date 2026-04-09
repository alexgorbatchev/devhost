import { type JSX } from "react";

import { InsetList, SectionHeader, Surface } from "../../components/ui";

interface IProofCard {
  description: string;
  items: readonly string[];
  title: string;
}

const proofCards: readonly IProofCard[] = [
  {
    description: "This is the small set of prerequisites behind the full experience.",
    items: [
      "bun",
      "Either a global caddy on PATH or a managed binary downloaded with devhost caddy download.",
      "nvim when [devtools.editor].ide = \"neovim\".",
    ],
    title: "Requirements",
  },
  {
    description: "Choose hostnames the browser can actually reach, or the local edge never gets a chance to help.",
    items: [
      "localhost and *.localhost work out of the box.",
      "Custom domains need loopback A or AAAA records, wildcard DNS, or exact local host entries.",
      "/etc/hosts only handles exact names, not wildcard domains.",
    ],
    title: "Hostname resolution",
  },
  {
    description: "One shared managed edge keeps multi-stack local work sane, but its lifecycle stays explicit.",
    items: [
      "devhost uses the downloaded Caddy binary when present and otherwise falls back to the global executable.",
      "It does not auto-download Caddy during stack startup.",
      "The managed Caddy admin API must already be available before the stack comes up.",
    ],
    title: "Managed edge lifecycle",
  },
  {
    description: "HTTPS on localhost has real operating-system caveats, and the product is honest about them.",
    items: [
      "On macOS, managed Caddy uses wildcard listeners because rootless loopback-specific binds on :443 do not work.",
      "That fixes startup, but it is not loopback-only routing on that platform.",
      "On non-macOS platforms, privileged-port setup still lives outside devhost.",
    ],
    title: "Platform behavior",
  },
  {
    description: "Containers fit when they publish a port back onto the host that devhost can actually route.",
    items: [
      "Route the host-visible port, such as 127.0.0.1:4000 after a 4000:4000 publish.",
      "Do not point devhost at Docker-internal names like http://api:4000.",
      "Keep the health check aligned with the port the host can actually reach.",
    ],
    title: "Docker-backed services",
  },
  {
    description: "The narrow scope is a feature. It is why the tool stays understandable and dependable.",
    items: [
      "Not Docker Compose",
      "Not a persistent daemon beyond the explicitly managed Caddy process",
      "Not a remote orchestration system",
      "Not a DNS manager",
      "Not a generic wildcard-host generator",
    ],
    title: "Non-goals",
  },
];

export function ProofSection(): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="proof-section-title" data-testid="ProofSection">
      <SectionHeader
        description="devhost sells well when its boundaries are clear: explicit prerequisites, honest platform caveats, a shared managed edge, and a deliberately tight scope."
        title="Serious local infrastructure, with honest boundaries."
        titleId="proof-section-title"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {proofCards.map((proofCard: IProofCard) => {
          return (
            <Surface key={proofCard.title} element="article" className="grid gap-4 p-5">
              <div className="grid gap-3">
                <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                  {proofCard.title}
                </h3>
                <p className="text-sm leading-7 text-muted-foreground">{proofCard.description}</p>
              </div>
              <InsetList items={proofCard.items} />
            </Surface>
          );
        })}
      </div>
    </section>
  );
}
