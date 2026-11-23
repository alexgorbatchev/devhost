package services

import (
	"context"
	"net"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

func TestStackRuntimeStackInfoStatesAndDetails(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	webPort := listener.Addr().(*net.TCPAddr).Port
	apiPort := 22310
	unselectedPort := 22400

	createdAt := time.Date(2026, 11, 20, 14, 1, 2, 0, time.UTC)
	exitedAt := time.Date(2026, 11, 20, 14, 1, 53, 0, time.UTC)

	control, err := devtools.StartControlServer(devtools.StartControlServerOptions{
		GetHealthResponse: func() (devtools.HealthResponse, error) { return devtools.HealthResponse{}, nil },
		StackName:         "Acme Shop",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = control.Stop() })
	control.PublishLogEntry("api", devtools.ServiceLogStreamStderr, "[api] \x1b[31mfatal: lost connection to database\x1b[0m")
	control.PublishLogEntry("api", devtools.ServiceLogStreamStderr, "[api]   ")

	rootDir := t.TempDir()
	rootManifest := filepath.Join(rootDir, "devhost.toml")
	includedManifest := filepath.Join(rootDir, "admin", "devhost.toml")

	m := ResolvedManifest{
		Name:           "Acme Shop",
		ManifestPath:   rootManifest,
		PrimaryService: "web",
		Caddy:          caddy.DefaultManagedCaddyGlobalSettings(),
		ServiceOrder:   []string{"web", "api", "worker", "starting-svc", "failed-svc", "omitted"},
		Services: map[string]ResolvedService{
			"web": {
				Name:     "web",
				Command:  []string{"web"},
				BindHost: "127.0.0.1",
				Port:     &webPort,
				Hosts:    []string{"shop.localhost", "www.shop.localhost"},
				Path:     new("/"),
				Health:   ResolvedHealthConfig{Kind: HealthKindTCP, Host: new("127.0.0.1"), Port: &webPort, Interval: 200, Timeout: 1000},
			},
			"api": {
				Name:     "api",
				Command:  []string{"api"},
				BindHost: "127.0.0.1",
				Port:     &apiPort,
				Hosts:    []string{"shop.localhost"},
				Path:     new("/api/*"),
				Health:   ResolvedHealthConfig{Kind: HealthKindProcess},
			},
			"worker": {
				Name:    "worker",
				Command: []string{"worker"},
				Health:  ResolvedHealthConfig{Kind: HealthKindProcess},
			},
			"starting-svc": {
				Name:    "starting-svc",
				Command: []string{"starting-svc"},
				Health:  ResolvedHealthConfig{Kind: HealthKindProcess},
			},
			"failed-svc": {
				Name:    "failed-svc",
				Command: []string{"failed-svc"},
				Health:  ResolvedHealthConfig{Kind: HealthKindProcess},
			},
		},
		Stopped: map[string]ResolvedService{
			"omitted": {Name: "omitted", Port: &unselectedPort},
		},
	}

	webStarted := &startedService{service: m.Services["web"], startedAt: createdAt}
	apiStarted := &startedService{service: m.Services["api"], startedAt: createdAt, hasExited: true, exitCode: 2, exitedAt: exitedAt}
	workerStarted := &startedService{service: m.Services["worker"], startedAt: createdAt}

	runtime := &stackRuntime{
		createdAt:     createdAt,
		stateSince:    map[string]time.Time{"web": createdAt, "worker": createdAt, "starting-svc": createdAt, "failed-svc": exitedAt},
		manifestFiles: []string{includedManifest, rootManifest},
		manifest:      &m,
		routes:        &stackRoutes{paths: caddy.CreateManagedCaddyPaths(t.TempDir())},
		starting:      map[string]bool{"starting-svc": true},
		failures:      map[string]string{"failed-svc": "cannot launch executable"},
		started:       []*startedService{webStarted, apiStarted, workerStarted},
		control:       control,
	}

	snapshot, err := runtime.stackInfo(context.Background())
	if err != nil {
		t.Fatalf("stackInfo() error = %v", err)
	}
	if snapshot.Name != "Acme Shop" {
		t.Fatalf("snapshot.Name = %q, want %q", snapshot.Name, "Acme Shop")
	}
	if !slices.Equal(snapshot.ManifestFiles, []string{rootManifest, includedManifest}) {
		t.Fatalf("snapshot.ManifestFiles = %v, want [%s %s]", snapshot.ManifestFiles, rootManifest, includedManifest)
	}
	if len(snapshot.Services) != 6 {
		t.Fatalf("len(snapshot.Services) = %d, want 6: %+v", len(snapshot.Services), snapshot.Services)
	}

	web := snapshot.Services[0]
	if web.Name != "web" || web.State != ServiceStateReady || !web.Primary || web.Port == nil || *web.Port != webPort || !slices.Equal(web.URLs, []string{"https://shop.localhost", "https://www.shop.localhost"}) || web.Since != "2026-11-20T14:01:02Z" {
		t.Fatalf("web = %+v", web)
	}

	api := snapshot.Services[1]
	if api.Name != "api" || api.State != ServiceStateExited || api.ExitCode == nil || *api.ExitCode != 2 || api.Since != "2026-11-20T14:01:53Z" || api.LastOutput != "fatal: lost connection to database" || !slices.Equal(api.URLs, []string{"https://shop.localhost/api/"}) {
		t.Fatalf("api = %+v", api)
	}

	worker := snapshot.Services[2]
	if worker.Name != "worker" || worker.State != ServiceStateReady || len(worker.URLs) != 0 || worker.LastOutput != "" {
		t.Fatalf("worker = %+v", worker)
	}

	startingSvc := snapshot.Services[3]
	if startingSvc.State != ServiceStateStarting {
		t.Fatalf("starting-svc = %+v", startingSvc)
	}

	failedSvc := snapshot.Services[4]
	if failedSvc.State != ServiceStateFailed || failedSvc.LastOutput != "cannot launch executable" {
		t.Fatalf("failed-svc = %+v", failedSvc)
	}

	omitted := snapshot.Services[5]
	if omitted.Name != "omitted" || omitted.State != ServiceStateNotStarted || omitted.Port == nil || *omitted.Port != unselectedPort || len(omitted.URLs) != 0 {
		t.Fatalf("omitted = %+v", omitted)
	}

	ready, runState := summarizeServicesState(snapshot.Services)
	if ready || runState != StackRunStateDegraded {
		t.Fatalf("summarizeServicesState() = (%v, %q), want (false, degraded)", ready, runState)
	}

	// Only ready + not-started services -> ready=true, runState=running.
	ready, runState = summarizeServicesState([]devtools.StackServiceInfo{web, worker, omitted})
	if !ready || runState != StackRunStateRunning {
		t.Fatalf("summarizeServicesState(ready+omitted) = (%v, %q), want (true, running)", ready, runState)
	}

	// Starting without failures -> ready=false, runState=starting.
	ready, runState = summarizeServicesState([]devtools.StackServiceInfo{web, startingSvc})
	if ready || runState != StackRunStateStarting {
		t.Fatalf("summarizeServicesState(ready+starting) = (%v, %q), want (false, starting)", ready, runState)
	}
}

func TestMatchLiveStackFindsRootSymlinkAndIncludedManifests(t *testing.T) {
	dir := t.TempDir()
	root := filepath.Join(dir, "devhost.toml")
	included := filepath.Join(dir, "sub", "devhost.toml")
	other := filepath.Join(dir, "other", "devhost.toml")

	stacks := []caddy.LiveStack{
		{Name: "root", PID: 1234, ManifestPath: root, ManifestFiles: []string{root, included}},
	}

	if got, ok := matchLiveStack(stacks, root); !ok || got.PID != 1234 {
		t.Fatalf("matchLiveStack(root) = (%+v, %v)", got, ok)
	}
	if got, ok := matchLiveStack(stacks, included); !ok || got.PID != 1234 {
		t.Fatalf("matchLiveStack(included) = (%+v, %v)", got, ok)
	}
	if _, ok := matchLiveStack(stacks, other); ok {
		t.Fatalf("matchLiveStack(other) = true, want false")
	}
}
