package services

import (
	"slices"
	"sort"
	"strconv"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func selectionManifest() manifest.Manifest {
	auto := func() *manifest.PortConfig { return &manifest.PortConfig{Auto: true} }
	service := func(name string, alwaysStart bool, dependsOn ...string) manifest.ValidatedService {
		return manifest.ValidatedService{Name: name, AlwaysStart: alwaysStart, BindHost: "127.0.0.1", Command: []string{"server"}, DependsOn: dependsOn, InjectPort: true, Port: auto()}
	}
	web := service("web", false, "api")
	web.Env = map[string]string{"DOCS": "http://127.0.0.1:{{ services.docs.port }}"}
	return manifest.Manifest{
		Name:         "slice",
		ServiceOrder: []string{"web", "api", "db", "docs", "mail", "queue"},
		Services: map[string]manifest.ValidatedService{
			"web":   web,
			"api":   service("api", false, "db"),
			"db":    service("db", false),
			"docs":  service("docs", false),
			"mail":  service("mail", true, "queue"),
			"queue": service("queue", false),
		},
	}
}

func sortedServiceNames(services map[string]ResolvedService) []string {
	names := make([]string, 0, len(services))
	for name := range services {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func TestResolveRequestedServicePortsSelectsServices(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		requested   []string
		wantStarted []string
		wantStopped []string
	}{
		{
			name:        "no names start every service",
			wantStarted: []string{"api", "db", "docs", "mail", "queue", "web"},
			wantStopped: []string{},
		},
		{
			name:        "a named service brings its dependencies and the always-start services with theirs",
			requested:   []string{"web"},
			wantStarted: []string{"api", "db", "mail", "queue", "web"},
			wantStopped: []string{"docs"},
		},
		{
			name:        "a named leaf leaves its dependents stopped",
			requested:   []string{"db"},
			wantStarted: []string{"db", "mail", "queue"},
			wantStopped: []string{"api", "docs", "web"},
		},
		{
			name:        "naming an always-start service adds nothing",
			requested:   []string{"mail"},
			wantStarted: []string{"mail", "queue"},
			wantStopped: []string{"api", "db", "docs", "web"},
		},
		{
			name:        "several names combine",
			requested:   []string{"docs", "db"},
			wantStarted: []string{"db", "docs", "mail", "queue"},
			wantStopped: []string{"api", "web"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := ResolveRequestedServicePorts(selectionManifest(), tc.requested)
			if err != nil {
				t.Fatalf("ResolveRequestedServicePorts(%q) unexpected error = %v", tc.requested, err)
			}

			if started := sortedServiceNames(got.Services); !slices.Equal(started, tc.wantStarted) {
				t.Fatalf("ResolveRequestedServicePorts(%q) started = %q, want %q", tc.requested, started, tc.wantStarted)
			}

			if stopped := sortedServiceNames(got.Stopped); !slices.Equal(stopped, tc.wantStopped) {
				t.Fatalf("ResolveRequestedServicePorts(%q) stopped = %q, want %q", tc.requested, stopped, tc.wantStopped)
			}
		})
	}
}

func TestValidateRequestedServicesRejectsUnknownNames(t *testing.T) {
	t.Parallel()

	if err := ValidateRequestedServices(selectionManifest(), []string{"web", "db"}); err != nil {
		t.Fatalf("ValidateRequestedServices(known names) unexpected error = %v", err)
	}

	err := ValidateRequestedServices(selectionManifest(), []string{"web", "wbe", "cache"})
	want := `unknown services: "wbe", "cache"; the manifest defines: api, db, docs, mail, queue, web`
	if err == nil || err.Error() != want {
		t.Fatalf("ValidateRequestedServices(unknown names) error = %v, want %q", err, want)
	}
}

// A started service keeps the address it was given for a stopped one, so starting
// that one later changes nothing for the services already running.
func TestStoppedServicesKeepTheirAddressesForStartedOnes(t *testing.T) {
	t.Parallel()

	configured := selectionManifest()
	sliced, err := ResolveRequestedServicePorts(configured, []string{"web"})
	if err != nil {
		t.Fatalf("ResolveRequestedServicePorts(web) unexpected error = %v", err)
	}

	docs, ok := sliced.Stopped["docs"]
	if !ok || docs.Port == nil {
		t.Fatalf("stopped docs service has no resolved port: %#v", sliced.Stopped)
	}

	web := sliced.Services["web"]
	if want := "http://127.0.0.1:" + portText(*docs.Port); web.Env["DOCS"] != want {
		t.Fatalf("web DOCS = %q, want %q", web.Env["DOCS"], want)
	}

	if got := CreateInjectedServiceEnvironment(sliced, web)["DEVHOST_PORT_DOCS"]; got != portText(*docs.Port) {
		t.Fatalf("web DEVHOST_PORT_DOCS = %q, want %q", got, portText(*docs.Port))
	}

	grown, err := resolveReloadPorts(configured, sliced, []string{"web", "docs"})
	if err != nil {
		t.Fatalf("resolveReloadPorts(web, docs) unexpected error = %v", err)
	}

	if started, ok := grown.Services["docs"]; !ok || started.Port == nil || *started.Port != *docs.Port {
		t.Fatalf("started docs service = %#v, want port %d", grown.Services["docs"], *docs.Port)
	}

	if affected := affectedReloadServices(sliced, grown); len(affected) != 1 || !affected["docs"] {
		t.Fatalf("starting docs affects %v, want only docs", affected)
	}
}

func portText(port int) string {
	return strconv.Itoa(port)
}
