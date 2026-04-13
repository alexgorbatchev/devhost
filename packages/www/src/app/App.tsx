import { useEffect, useRef, useState, type JSX } from "react";

import { ActivityIcon } from "../components/icons/ActivityIcon";
import { DevtoolsIcon } from "../components/icons/DevtoolsIcon";
import { GitHubIcon } from "../components/icons/GitHubIcon";
import { LayersIcon } from "../components/icons/LayersIcon";
import { MoonIcon } from "../components/icons/MoonIcon";
import { ShieldIcon } from "../components/icons/ShieldIcon";
import { SunIcon } from "../components/icons/SunIcon";
import { CommandLine, Callout, InlineCallout } from "../components/ui";

import {
  createRrwebDemoRecording,
  exportRrwebDemoRecording,
  FeatureReplayPanel,
  loadRrwebDemoRecording,
  RrwebDemoPanel,
  type IRrwebDemoRecording,
  type IRrwebDemoRecordingController,
} from "../features/rrweb";

type RecordingPhase = "arming" | "idle" | "preview" | "recording";

type ThemePreference = "light" | "dark";

const isDevelopmentMode: boolean = process.env.NODE_ENV === "development";
const themeStorageKey: string = "devhost-test-theme";

type MarketingReplayStatus = "error" | "loading" | "missing" | "ready";

interface IMarketingDemoTab {
  id: string;
  label: string;
  recordingUrl: string;
}

const marketingDemoTabs: readonly IMarketingDemoTab[] = [
  { id: "managed-edge", label: "Managed edge", recordingUrl: "/recordings/marketing/managed-edge.json" },
  { id: "stack-lifecycle", label: "Stack lifecycle", recordingUrl: "/recordings/marketing/stack-lifecycle.json" },
  { id: "runtime-context", label: "Runtime context", recordingUrl: "/recordings/marketing/runtime-context.json" },
  { id: "devtools", label: "Devtools overlay", recordingUrl: "/recordings/marketing/devtools.json" },
  { id: "agent-handoff", label: "Agent handoff", recordingUrl: "/recordings/marketing/annotation.json" },
];

function MarketingDemoReplay(): JSX.Element {
  const activeTabIdRef = useRef<string>(marketingDemoTabs[0]?.id ?? "");
  const [activeTabId, setActiveTabId] = useState<string>(activeTabIdRef.current);
  const [recording, setRecording] = useState<IRrwebDemoRecording | null>(null);
  const [status, setStatus] = useState<MarketingReplayStatus>("loading");

  const activeTab = marketingDemoTabs.find((tab) => tab.id === activeTabId) ?? marketingDemoTabs[0]!;

  useEffect(() => {
    let isCancelled = false;
    setStatus("loading");
    setRecording(null);

    loadRrwebDemoRecording(activeTab.recordingUrl)
      .then((nextRecording) => {
        if (isCancelled) return;
        setRecording(nextRecording);
        setStatus(nextRecording === null ? "missing" : "ready");
      })
      .catch((error) => {
        if (isCancelled) return;
        console.error(error);
        setRecording(null);
        setStatus("error");
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab.recordingUrl]);

  let emptyMessage = "Loading recording...";
  if (status === "error") emptyMessage = "Failed to load recording.";
  if (status === "missing") emptyMessage = "Recording not found.";

  return (
    <div className="my-8 grid gap-4" aria-label="Feature demonstration recording">
      <div className="flex flex-wrap gap-2 border-b border-border-subtle pb-4">
        {marketingDemoTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={
                isActive
                  ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm"
                  : "rounded-md bg-transparent px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-subtle hover:text-foreground"
              }
              aria-selected={isActive}
              role="tab"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <FeatureReplayPanel emptyMessage={emptyMessage} recording={recording} />
    </div>
  );
}

export function App(): JSX.Element {
  const activeRecordingControllerRef = useRef<IRrwebDemoRecordingController | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");
  const [rrwebDemoRecording, setRrwebDemoRecording] = useState<IRrwebDemoRecording | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    return readStoredThemePreference(window.localStorage);
  });
  const isRecordingRrwebDemo: boolean = recordingPhase === "arming" || recordingPhase === "recording";

  function handleStartRrwebRecording(): void {
    if (isRecordingRrwebDemo) {
      return;
    }

    setRrwebDemoRecording(null);
    setRecordingPhase("arming");
  }

  function handleStopRrwebRecording(): void {
    if (recordingPhase === "arming") {
      setRecordingPhase("idle");
      return;
    }

    const activeRecordingController = activeRecordingControllerRef.current;

    if (activeRecordingController === null) {
      return;
    }

    const recording = activeRecordingController.stop();

    activeRecordingControllerRef.current = null;
    setRecordingPhase("preview");
    setRrwebDemoRecording(recording);
  }

  function handleExportRrwebRecording(): void {
    if (rrwebDemoRecording === null) {
      return;
    }

    exportRrwebDemoRecording(rrwebDemoRecording);
  }

  useEffect(() => {
    if (recordingPhase !== "arming") {
      return;
    }

    let firstAnimationFrameId = 0;
    let secondAnimationFrameId = 0;

    firstAnimationFrameId = window.requestAnimationFrame((): void => {
      secondAnimationFrameId = window.requestAnimationFrame((): void => {
        activeRecordingControllerRef.current = createRrwebDemoRecording();
        setRecordingPhase("recording");
      });
    });

    return (): void => {
      window.cancelAnimationFrame(firstAnimationFrameId);
      window.cancelAnimationFrame(secondAnimationFrameId);
    };
  }, [recordingPhase]);

  useEffect(() => {
    return (): void => {
      const activeRecordingController = activeRecordingControllerRef.current;

      if (activeRecordingController !== null) {
        activeRecordingController.stop();
        activeRecordingControllerRef.current = null;
      }
    };
  }, []);

  useEffect((): void => {
    document.documentElement.dataset.theme = themePreference;
    window.localStorage.setItem(themeStorageKey, themePreference);
  }, [themePreference]);

  useEffect((): void => {
    // @ts-ignore
    if (window.hljs) {
      // @ts-ignore
      window.hljs.highlightAll();
    }
  }, []);

  return (
    <main className="app-shell relative min-h-dvh bg-background text-foreground flex flex-col" data-testid="App">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between max-w-4xl">
          <div className="flex font-semibold text-lg items-center gap-2">@alexgorbatchev/devhost</div>

          <div className="flex items-center gap-4">
            <button
              onClick={(): void => {
                setThemePreference(themePreference === "dark" ? "light" : "dark");
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border-strong bg-card text-muted-foreground shadow-[var(--shadow-soft)] transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Toggle theme"
            >
              {themePreference === "dark" ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 container mx-auto px-4 py-12 max-w-4xl app-frame">
        <div className="space-y-6 pb-12 border-b border-border">
          <h1 className="text-4xl font-extrabold tracking-tight lg:text-5xl mb-4">
            <span className="bg-foreground text-background px-3 py-0 rounded-md">devhost</span>
          </h1>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl mb-4 text-muted-foreground">
            replace <span className="text-foreground">localhost:3000</span> with{" "}
            <span className="text-foreground">https://app.localhost</span> and then some more
          </h1>

          <div className="flex gap-4 pt-4">
            <a
              href="#quick-start"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
            >
              Get Started
            </a>
            <a
              href="https://github.com/alexgorbatchev/devhost"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2"
            >
              <GitHubIcon className="mr-2" />
              GitHub
            </a>
          </div>
        </div>

        <div className="prose mt-12 max-w-none">
          <p>
            Use it when <code>localhost:3000</code> stops being good enough — auth callbacks, cookie/domain behavior,
            multi-service stacks, or just wanting <code>app.localhost</code> and <code>api.app.localhost</code> to
            behave more like a real app.
          </p>

          <MarketingDemoReplay />

          {isDevelopmentMode ? (
            <RrwebDemoPanel
              isDevelopmentMode={isDevelopmentMode}
              isRecording={isRecordingRrwebDemo}
              onExportRecording={handleExportRrwebRecording}
              onStartRecording={handleStartRrwebRecording}
              onStopRecording={handleStopRrwebRecording}
              recording={rrwebDemoRecording}
            />
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
            <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary/10 rounded-full text-primary">
                  <ShieldIcon />
                </div>
                <h3 className="font-semibold text-lg !mt-0 !mb-0">Secure Routing</h3>
              </div>
              <p className="text-sm text-muted-foreground !mb-0">
                Routes local services onto HTTPS hostnames through a managed Caddy instance, handling certificates
                automatically.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary/10 rounded-full text-primary">
                  <LayersIcon />
                </div>
                <h3 className="font-semibold text-lg !mt-0 !mb-0">Stack Management</h3>
              </div>
              <p className="text-sm text-muted-foreground !mb-0">
                Starts one service or a full stack from a declarative <code>devhost.toml</code> file, in proper
                dependency order.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary/10 rounded-full text-primary">
                  <ActivityIcon />
                </div>
                <h3 className="font-semibold text-lg !mt-0 !mb-0">Health Checks</h3>
              </div>
              <p className="text-sm text-muted-foreground !mb-0">
                Waits for configurable health checks to pass before exposing routes, ensuring your stack is truly ready.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card text-card-foreground shadow-sm p-6">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-primary/10 rounded-full text-primary">
                  <DevtoolsIcon />
                </div>
                <h3 className="font-semibold text-lg !mt-0 !mb-0">Injected Devtools</h3>
              </div>
              <p className="text-sm text-muted-foreground !mb-0">
                Optionally injects browser devtools for logs, service status, AI annotations, source jumping, Neovim,
                and aggregated third-party launcher buttons.
              </p>
            </div>
          </div>

          <h2 id="quick-start">Quick start</h2>

          <h3>Installation</h3>
          <CommandLine command="npm install -g @alexgorbatchev/devhost" />

          <h3>Minimal example</h3>
          <p>
            Configure your stack in <code>devhost.toml</code>, then run it through <code>devhost</code>.
          </p>

          <pre>
            <code className="language-toml">{`name = "hello-stack"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "foo.localhost"
dependsOn = ["api"]

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "api.foo.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }`}</code>
          </pre>

          <p>
            Most projects should wrap <code>devhost</code> in the package's <code>package.json</code> so you can run it
            through the usual dev script from the manifest directory:
          </p>

          <pre>
            <code className="language-json">{`{
  "scripts": {
    "dev": "devhost"
  }
}`}</code>
          </pre>

          <p>Then run your usual package-manager dev command from that package directory:</p>

          <CommandLine
            command={`$ npm run dev
$ open https://foo.localhost`}
          />

          <p>
            (<code>pnpm dev</code>, <code>yarn dev</code>, and <code>bun run dev</code> work the same way when they
            invoke the same script.)
          </p>

          <Callout title="Important">
            <p className="!mt-0">
              <code>devhost</code> manages HTTPS routing through Caddy, not DNS. Your chosen hostnames must already
              resolve to this machine or the browser will never reach the local proxy.
            </p>
            <p>
              For custom domains, that means loopback resolution, such as exact <code>A</code> / <code>AAAA</code>{" "}
              records to <code>127.0.0.1</code> / <code>::1</code>, wildcard DNS records on your domain, or local host
              entries for exact names. <code>/etc/hosts</code> can be used, however it only handles <em>exact</em>{" "}
              hostnames.
            </p>
            <p className="!mb-0">
              Good out-of-the-box choices are <code>localhost</code> and subdomains under <code>*.localhost</code>, such
              as <code>foo.localhost</code> and <code>api.foo.localhost</code>, because they work without additional DNS
              configuration.
            </p>
          </Callout>

          <h2>What it does</h2>
          <p>
            <code>devhost</code>:
          </p>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">routes local apps onto HTTPS hostnames through one shared managed Caddy instance</li>
            <li className="mb-2">
              starts local child processes from <code>devhost.toml</code>
            </li>
            <li className="mb-2">
              injects runtime context such as <code>PORT</code> and <code>DEVHOST_*</code> environment variables
            </li>
            <li className="mb-2">
              validates manifests, reserves public hosts, reserves fixed bind ports, and waits for health checks before
              routing traffic
            </li>
            <li className="mb-2">
              allocates <code>port = "auto"</code> best-effort and retries on clear bind-collision startup failures
            </li>
            <li className="mb-2">
              optionally injects a devtools UI for annotations, source navigation, and browser-hosted Neovim
            </li>
          </ul>

          <h2>Requirements</h2>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              <code>bun</code>
            </li>
            <li className="mb-2">
              either:
              <ul className="list-disc ml-6 mt-2 mb-2">
                <li className="mb-2">
                  a global <code>caddy</code> on your <code>PATH</code>, or
                </li>
                <li className="mb-2">
                  a managed Caddy binary downloaded with <code>devhost caddy download</code>
                </li>
              </ul>
            </li>
            <li className="mb-2">
              <code>nvim</code> when <code>[devtools.editor].ide = "neovim"</code>
            </li>
          </ul>

          <h2>Managed Caddy</h2>
          <p>
            Download the managed Caddy binary if you do not already have <code>caddy</code> on your <code>PATH</code>:
          </p>

          <CommandLine command="devhost caddy download" />

          <p>
            <code>devhost</code> uses that downloaded binary when present. Otherwise it falls back to the global{" "}
            <code>caddy</code> executable from your <code>PATH</code>. It does <strong>not</strong> auto-download Caddy
            during <code>devhost caddy start</code> or stack startup.
          </p>

          <Callout title="Important">
            <p className="!mt-0">
              To get HTTPS working, Caddy uses a self-signed certificate, which obviously isn't trusted by default.
            </p>
            <p className="!mb-0">
              The <code>devhost caddy trust</code> will prompt for your password and install Caddy's CA into the system
              trust store.
            </p>
          </Callout>

          <p>Start the shared managed Caddy instance before running one or more stacks:</p>
          <CommandLine command="devhost caddy start" />

          <p>Stop it when you are done with all stacks:</p>
          <CommandLine command="devhost caddy stop" />

          <p>The generated Caddy config uses these defaults:</p>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              state dir: <code>DEVHOST_STATE_DIR</code>, else <code>XDG_STATE_HOME/devhost</code>, else{" "}
              <code>~/.local/state/devhost</code>
            </li>
            <li className="mb-2">
              admin API: <code>127.0.0.1:20193</code> unless <code>DEVHOST_CADDY_ADMIN_ADDRESS</code> is set
            </li>
            <li className="mb-2">
              listener binding on macOS: wildcard listeners, because macOS denies rootless loopback-specific binds on{" "}
              <code>:443</code>
            </li>
            <li className="mb-2">
              listener binding on non-macOS: loopback only via Caddy <code>default_bind 127.0.0.1 [::1]</code>
            </li>
            <li className="mb-2">
              unmatched hostnames: a generated 404 page listing the currently active devhost hostnames as HTTPS links
            </li>
          </ul>

          <p>
            Managed Caddy lifecycle is shared and manual. <code>devhost</code> stack startup requires the managed Caddy
            admin API to already be available.
          </p>

          <h3>Shared multi-stack behavior</h3>
          <p>Multiple projects can run against the same managed Caddy instance at the same time.</p>
          <p>The routing contract is strict:</p>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">hostname ownership is exclusive across projects</li>
            <li className="mb-2">
              one project cannot claim a hostname that is already owned by another live devhost process
            </li>
            <li className="mb-2">one manifest may mount multiple services under the same hostname on distinct paths</li>
            <li className="mb-2">
              fixed numeric bind ports are claimed globally across devhost processes before service spawn
            </li>
            <li className="mb-2">
              <code>port = "auto"</code> remains best-effort in v1; devhost retries on clear bind collisions, but it
              does not provide a cross-process global auto-port allocator
            </li>
          </ul>

          <h2>Stack lifecycle</h2>
          <p>
            When you run <code>devhost</code>, it:
          </p>
          <ol className="list-decimal ml-6 mb-6 space-y-2">
            <li>
              discovers <code>devhost.toml</code> upward from the current directory, unless <code>--manifest</code> is
              provided
            </li>
            <li>parses TOML and validates schema and semantics</li>
            <li>
              resolves <code>port = "auto"</code> before spawning children
            </li>
            <li>requires the managed Caddy admin API to already be available</li>
            <li>reserves fixed numeric bind ports before starting any service that uses them</li>
            <li>reserves every public hostname before starting any service</li>
            <li>starts services in dependency order</li>
            <li>waits for each service health check before routing it</li>
            <li>removes routes and reservations on shutdown or startup failure</li>
          </ol>
          <p>
            <code>devhost</code>-owned logs use the manifest <code>name</code> when available and fall back to{" "}
            <code>[devhost]</code>. Child service logs remain prefixed with <code>[service-name]</code>.
          </p>

          <p>
            Each TOML table must be declared once. Keep all fields for a service inside a single{" "}
            <code>[services.&lt;name&gt;]</code> block instead of reopening that table later.
          </p>

          <h2>Docker-backed services</h2>
          <p>
            <code>devhost</code> can front a Docker- or Compose-managed backend, but only when the container publishes a
            port onto the host and <code>devhost</code> routes to that host-visible port. <code>devhost</code> does not
            proxy to Docker-internal service names or container-network-only addresses.
          </p>

          <p>
            For example, if your Compose service publishes <code>4000:4000</code>, you can route it like this:
          </p>

          <pre>
            <code className="language-toml">{`name = "hello-stack"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "hello.localhost"
dependsOn = ["api"]

[services.api]
command = ["docker", "compose", "up", "--build", "api"]
port = 4000
host = "api.hello.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }`}</code>
          </pre>

          <h2>Injected environment</h2>
          <p>
            <code>devhost</code> injects environment variables into each service child process. Only{" "}
            <code>DEVHOST_BIND_HOST</code> and <code>PORT</code> are operational bind inputs. The remaining variables
            are context metadata and must not be used as socket bind targets.
          </p>

          <h3>Operational bind inputs</h3>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              <code>DEVHOST_BIND_HOST</code>: the actual interface the child process is expected to listen on. Use this
              for binding sockets.
            </li>
            <li className="mb-2">
              <code>PORT</code>: the listening port selected by <code>devhost</code>. Injected when the service defines{" "}
              <code>port</code>, unless <code>injectPort = false</code>.
            </li>
            <li className="mb-2">
              <code>injectPort = false</code>: service-level opt-out for <code>PORT</code> injection.{" "}
              <code>devhost</code> still routes and health-checks the configured service port, but it does not export{" "}
              <code>PORT</code> into the child process environment.
            </li>
          </ul>

          <h3>Routed-service context</h3>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              <code>DEVHOST_HOST</code>: the public routed hostname from the service <code>host</code> field.
            </li>
            <li className="mb-2">
              <code>DEVHOST_PATH</code>: the public routed subpath from the service <code>path</code> field.
            </li>
          </ul>

          <h2>Devtools</h2>
          <p>
            When <code>devtools</code> are enabled, routed traffic is split like this:
          </p>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              <code>/__devhost__/*</code> → <code>devtools</code> control server
            </li>
            <li className="mb-2">
              <code>Sec-Fetch-Dest: document</code> requests → document injector server
            </li>
            <li className="mb-2">everything else → app directly</li>
          </ul>

          <p>
            Routed services in the injected status panel become links automatically, and clicking one opens that service
            URL in a new browser tab/window by default.
          </p>

          <p>
            When <code>[devtools.externalToolbars].enabled = true</code> (the default), devhost also detects supported
            third-party devtools launcher buttons, hides those native launcher buttons, and re-renders them inside the
            injected overlay. The native tool panels themselves stay untouched.
          </p>

          <h3>AI annotations</h3>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              hold <code>Alt</code> (<code>Option</code> on macOS) to enter annotation selection mode
            </li>
            <li className="mb-2">
              click one or more page elements while holding <code>Alt</code> to place numbered markers
            </li>
            <li className="mb-2">
              release <code>Alt</code> to leave selection mode while keeping the current draft open
            </li>
            <li className="mb-2">
              write a comment that references markers like <InlineCallout hasBorder>#1</InlineCallout> and{" "}
              <InlineCallout hasBorder>#2</InlineCallout>
            </li>
            <li className="mb-2">
              click <code>Submit</code> or press <code>⌘ ↵</code> / <code>Ctrl + Enter</code> to start an agent session
              seeded with the draft
            </li>
            <li className="mb-2">
              when <code>Append to active session queue</code> is enabled, the draft is added to the matching routed
              service&apos;s active agent queue instead of being injected immediately into a busy terminal
            </li>
            <li className="mb-2">
              queued annotations are bucketed by routed service host/path, survive browser reloads and{" "}
              <code>devhost</code>
              restarts, drain automatically when the agent emits <code>OSC 1337;SetAgentStatus=finished</code>, and can
              be edited or removed from the injected queue panel while they are queued or paused
            </li>
          </ul>

          <p>
            When the host page is a React development build that exposes component source metadata, each marker also
            captures the nearest available component source location.
          </p>

          <h3>Open source in IDE</h3>
          <p>
            <code>Alt</code> + <code>right-click</code> component-source navigation uses the configured{" "}
            <code>[devtools.editor].ide</code> value. When <code>[devtools.editor].ide = "neovim"</code>, devhost
            launches Neovim inside the injected xterm terminal.
          </p>

          <h3>Annotation agents</h3>
          <p>
            Configure a project-local annotation launcher with a root-level <code>[agent]</code> table.
          </p>

          <p>Use built-in agent adapters for quick setup:</p>
          <pre>
            <code className="language-toml">{`[agent]
adapter = "claude-code"`}</code>
          </pre>

          <p>
            Supported adapters: <code>"pi"</code>, <code>"claude-code"</code>, and <code>"opencode"</code>. When{" "}
            <code>[agent]</code> is omitted, <code>devhost</code> starts Pi by default.
          </p>

          <p>For custom annotation agents, provide an explicit command:</p>

          <pre>
            <code className="language-toml">{`[agent]
displayName = "My Agent"
command = ["bun", "./scripts/devhost-agent.ts"]
cwd = "."

[agent.env]
DEVHOST_AGENT_MODE = "annotation"`}</code>
          </pre>

          <p>
            <code>devhost</code> executes custom agent commands directly, not through a shell string. For configured
            commands, <code>devhost</code> writes the annotation JSON and rendered prompt to temp files and injects them
            via <code>DEVHOST_AGENT_*</code> environment variables.
          </p>

          <p>
            All built-in adapters natively integrate terminal OSC sequences to reflect working and idle states during
            embedded session execution, and the durable annotation queue now depends on those same status events to know
            when to drain queued work:
          </p>

          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              <code>pi</code> leverages an injected extension to capture <code>agent_start</code> and{" "}
              <code>agent_end</code> hooks
            </li>
            <li className="mb-2">
              <code>claude-code</code> utilizes its <code>--settings</code> API mapping commands to its native session
              and user prompt hooks
            </li>
            <li className="mb-2">
              <code>opencode</code> integrates via an inline <code>--config</code> plugin listening for{" "}
              <code>session.status</code> events
            </li>
          </ul>

          <p>
            Custom annotation agents must emit <code>OSC 1337;SetAgentStatus=working</code> when they begin handling an
            annotation and <code>OSC 1337;SetAgentStatus=finished</code> when they are ready for the next queued item.{" "}
            <code>devhost</code> accepts either BEL (<code>\x07</code>) or ST (<code>\x1b\\</code>) OSC terminators.
          </p>

          <h2>Troubleshooting</h2>
          <h3>Vite: localhost and 127.0.0.1 can be different apps</h3>
          <p>
            Some dev servers print a URL like <code>http://localhost:5173</code>, and it is natural to copy that port
            into <code>devhost.toml</code>.
          </p>
          <p>
            On some machines, though, <code>http://localhost:5173</code> and <code>http://127.0.0.1:5173</code> do not
            hit the same listener. <code>localhost</code> may resolve to <code>::1</code>, while <code>devhost</code>
            defaults <code>bindHost</code> to <code>127.0.0.1</code> for routed services.
          </p>
          <p>
            That can produce confusing behavior where the direct printed <code>localhost</code> URL works, but the
            routed <code>*.localhost</code> hostname lands on a different local process or response. When{" "}
            <code>devhost</code>
            detects that mismatch, it logs an explicit startup warning.
          </p>
          <p>
            For Vite-style apps that are actually listening on IPv6 loopback, set <code>bindHost = "::1"</code>{" "}
            explicitly:
          </p>
          <pre>
            <code className="language-toml">{`[services.app]
command = ["bun", "run", "dev"]
cwd = "."
port = 5173
bindHost = "::1"
host = "app.localhost"`}</code>
          </pre>
          <p>If you are unsure which listener your app is using, compare these directly:</p>
          <pre>
            <code className="language-bash">{`curl -I http://localhost:5173/
curl -I http://127.0.0.1:5173/
curl -I http://[::1]:5173/`}</code>
          </pre>
          <p>
            If those responses differ, set <code>bindHost</code> explicitly instead of relying on the default.
          </p>
          <h3>Composite services: inherited PORT can miswire child processes</h3>
          <p>
            Some "one command" dev scripts are really wrappers that launch multiple long-lived processes, such as a
            frontend dev server plus an API worker.
          </p>
          <p>
            By default, <code>devhost</code> injects the configured service <code>port</code> as <code>PORT</code> into
            that top-level command. If the wrapper passes its environment through unchanged, every nested child process
            may inherit the same <code>PORT</code>.
          </p>
          <p>That can produce confusing failures such as:</p>
          <ul className="list-disc ml-6 mb-6">
            <li className="mb-2">
              one child binding the routed service port even though it was meant for another nested process
            </li>
            <li className="mb-2">
              another child silently moving to a fallback port after seeing the inherited port already in use
            </li>
            <li className="mb-2">
              the frontend still proxying <code>/api</code> to its usual target while the API actually bound somewhere
              else
            </li>
            <li className="mb-2">
              routed requests returning backend <code>404</code>s even though the main page appears to load normally
            </li>
          </ul>
          <p>
            If your manifest service launches multiple dev processes under one command, prefer splitting them into
            separate <code>devhost</code> services. If you intentionally keep a composite wrapper, set{" "}
            <code>injectPort = false</code> on that service and configure the underlying processes explicitly instead:
          </p>
          <pre>
            <code className="language-toml">{`[services.app]
command = ["bun", "run", "dev"]
cwd = "."
port = 5173
injectPort = false
host = "app.localhost"`}</code>
          </pre>
        </div>
      </div>

      <footer className="border-t border-border mt-auto py-8">
        <div className="container mx-auto px-4 text-center text-muted-foreground text-sm">
          <p>devhost by Alex Gorbatchev</p>
        </div>
      </footer>
    </main>
  );
}

function parseThemePreference(value: string | null): ThemePreference {
  if (value === "light" || value === "dark") {
    return value;
  }

  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }

  return "light";
}

function readStoredThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  return parseThemePreference(storage.getItem(themeStorageKey));
}
