package services

import (
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

func sliceServiceBody(name string) string {
	return reloadServiceBody(name, name, name+".slice.localhost")
}

func alwaysStartServiceBody(name string) string {
	return strings.Replace(sliceServiceBody(name), "port = \"auto\"", "alwaysStart = true\nport = \"auto\"", 1)
}

func sliceRoutePath(f *reloadStackFixture, name string) string {
	return filepath.Join(f.paths.RegistrationsDirectoryPath, name+".slice.localhost_"+name+"_2f.json")
}

func readSliceHealth(t *testing.T, f *reloadStackFixture) (started []string, stopped []string) {
	t.Helper()
	health, err := f.control.GetHealthResponse()
	if err != nil {
		t.Fatal(err)
	}
	for _, service := range health.Services {
		started = append(started, service.Name)
	}
	for _, service := range health.StoppedServices {
		stopped = append(stopped, service.Name)
	}
	return started, stopped
}

func assertSliceHealth(t *testing.T, f *reloadStackFixture, wantStarted []string, wantStopped []string) {
	t.Helper()
	started, stopped := readSliceHealth(t, f)
	if !slices.Equal(started, wantStarted) || !slices.Equal(stopped, wantStopped) {
		t.Fatalf("health lists started %q and stopped %q, want %q and %q", started, stopped, wantStarted, wantStopped)
	}
}

func TestStartNamedServicesLeavesTheRestStoppedUntilStarted(t *testing.T) {
	body := sliceServiceBody("web") + sliceServiceBody("docs") + alwaysStartServiceBody("db")
	f := startReloadStackRequested(t, body, false, []string{"web"})

	assertSliceHealth(t, f, []string{"web", "db"}, []string{"docs"})
	if !f.logs.contains("not started: docs") {
		t.Fatal("startup did not report the service it left stopped")
	}
	if _, err := os.Stat(sliceRoutePath(f, "docs")); !os.IsNotExist(err) {
		t.Fatalf("stopped service has a route: %v", err)
	}
	hosts, err := os.ReadDir(f.paths.RegistrationsDirectoryPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range hosts {
		if strings.Contains(entry.Name(), "docs.slice.localhost") {
			t.Fatalf("stopped service holds a hostname claim or route: %s", entry.Name())
		}
	}

	web := readRestartRoute(t, sliceRoutePath(f, "web"))
	webPID := reloadPID(t, web.AppPort)
	db := readRestartRoute(t, sliceRoutePath(f, "db"))
	dbPID := reloadPID(t, db.AppPort)

	if err := f.control.RestartService([]string{"docs"}); err == nil || err.Error() != "service docs is not started" {
		t.Fatalf("restarting a stopped service: error = %v, want %q", err, "service docs is not started")
	}
	if err := f.control.StartService([]string{"web"}); err == nil || err.Error() != "service web is already started" {
		t.Fatalf("starting a started service: error = %v, want %q", err, "service web is already started")
	}
	if err := f.control.StartService([]string{"cache"}); err == nil || err.Error() != "unknown service: cache" {
		t.Fatalf("starting an unknown service: error = %v, want %q", err, "unknown service: cache")
	}

	if err := f.control.StartService([]string{"docs"}); err != nil {
		t.Fatalf("starting a stopped service: %v", err)
	}
	docs := readRestartRoute(t, sliceRoutePath(f, "docs"))
	assertRestartResponse(t, serverURL(docs.AppPort, "/"), "docs")
	assertSliceHealth(t, f, []string{"web", "docs", "db"}, nil)
	if !f.logs.contains("started services: docs") {
		t.Fatal("starting a stopped service was not logged")
	}
	if reloadPID(t, web.AppPort) != webPID || reloadPID(t, db.AppPort) != dbPID {
		t.Fatal("starting a stopped service restarted a running one")
	}
}

func TestStartingAStoppedServiceStartsWhatItDependsOn(t *testing.T) {
	admin := strings.Replace(sliceServiceBody("admin"), "port = \"auto\"", "dependsOn = [\"api\"]\nport = \"auto\"", 1)
	f := startReloadStackRequested(t, sliceServiceBody("web")+admin+sliceServiceBody("api"), false, []string{"web"})
	assertSliceHealth(t, f, []string{"web"}, []string{"admin", "api"})

	if err := f.control.StartService([]string{"admin"}); err != nil {
		t.Fatal(err)
	}
	assertSliceHealth(t, f, []string{"web", "admin", "api"}, nil)
	for _, name := range []string{"admin", "api"} {
		route := readRestartRoute(t, sliceRoutePath(f, name))
		assertRestartResponse(t, serverURL(route.AppPort, "/"), name)
	}
}

func TestSliceSurvivesManifestReloadAndStackRestart(t *testing.T) {
	body := sliceServiceBody("web") + sliceServiceBody("docs")
	f := startReloadStackRequested(t, body, false, []string{"web"})
	web := readRestartRoute(t, sliceRoutePath(f, "web"))

	// A service added to the manifest stays stopped unless it is marked alwaysStart.
	f.write(t, body+sliceServiceBody("extra")+alwaysStartServiceBody("db"))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.count("configuration reloaded") == 1 })
	assertSliceHealth(t, f, []string{"web", "db"}, []string{"docs", "extra"})
	if _, err := os.Stat(sliceRoutePath(f, "extra")); !os.IsNotExist(err) {
		t.Fatalf("a service added while a slice runs was started: %v", err)
	}

	// An edit to a stopped service changes nothing that runs.
	pid := reloadPID(t, web.AppPort)
	f.write(t, body+reloadServiceBody("extra", "edited", "extra.slice.localhost")+alwaysStartServiceBody("db"))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.count("configuration reloaded") == 2 })
	if reloadPID(t, web.AppPort) != pid {
		t.Fatal("editing a stopped service restarted a running one")
	}
	if err := f.control.StartService([]string{"extra"}); err != nil {
		t.Fatal(err)
	}
	extra := readRestartRoute(t, sliceRoutePath(f, "extra"))
	assertRestartResponse(t, serverURL(extra.AppPort, "/"), "edited")

	if err := f.control.RestartStack(); err != nil {
		t.Fatal(err)
	}
	assertSliceHealth(t, f, []string{"web", "extra", "db"}, []string{"docs"})
	if _, err := os.Stat(sliceRoutePath(f, "docs")); !os.IsNotExist(err) {
		t.Fatalf("stack restart started a stopped service: %v", err)
	}
}

func TestFailedStartOfAStoppedServiceLeavesTheSliceRunning(t *testing.T) {
	failing := reloadServiceBody("docs", "fail", "docs.slice.localhost")
	f := startReloadStackRequested(t, sliceServiceBody("web")+failing, false, []string{"web"})
	web := readRestartRoute(t, sliceRoutePath(f, "web"))
	pid := reloadPID(t, web.AppPort)

	if err := f.control.StartService([]string{"docs"}); err == nil {
		t.Fatal("starting a service that exits at launch reported success")
	}
	assertSliceHealth(t, f, []string{"web"}, []string{"docs"})
	if reloadPID(t, web.AppPort) != pid {
		t.Fatal("a failed start restarted a running service")
	}
	if _, err := os.Stat(sliceRoutePath(f, "docs")); !os.IsNotExist(err) {
		t.Fatalf("a failed start left a route: %v", err)
	}

	f.write(t, sliceServiceBody("web")+sliceServiceBody("docs"))
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reloaded") })
	if err := f.control.StartService([]string{"docs"}); err != nil {
		t.Fatalf("retry after repairing the service: %v", err)
	}
	assertSliceHealth(t, f, []string{"web", "docs"}, nil)
}

func TestStartingAStoppedServiceKeepsItsRepositorySiblingsRunning(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	service := func(name, directory string) string {
		return strings.Replace(sliceServiceBody(name), "command = ", fmt.Sprintf("cwd = %q\ncommand = ", filepath.Join(root, directory)), 1)
	}
	f := startReloadStackRequested(t, service("web", "web")+service("api", "api"), true, []string{"web"})
	health, err := f.control.GetHealthResponse()
	if err != nil || len(health.Repositories) != 1 || !slices.Equal(health.Repositories[0].ServiceNames, []string{"web"}) {
		t.Fatalf("repository lists stopped services: %#v, %v", health, err)
	}
	if err := f.control.SwitchWorktree(health.Repositories[0].ID, linked); err != nil {
		t.Fatal(err)
	}
	web := readRestartRoute(t, sliceRoutePath(f, "web"))
	pid := reloadPID(t, web.AppPort)

	if err := f.control.StartService([]string{"api"}); err != nil {
		t.Fatal(err)
	}
	if reloadPID(t, web.AppPort) != pid {
		t.Fatal("starting a stopped service restarted its repository sibling")
	}
	api := readRestartRoute(t, sliceRoutePath(f, "api"))
	assertRestartResponse(t, serverURL(api.AppPort, "/cwd"), filepath.Join(linked, "api"))
	health, err = f.control.GetHealthResponse()
	if err != nil || !slices.Equal(health.Repositories[0].ServiceNames, []string{"web", "api"}) {
		t.Fatalf("repository membership after start: %#v, %v", health, err)
	}
}

func TestCollectServicesHealthListsStoppedServicesInManifestOrder(t *testing.T) {
	t.Parallel()

	manifest := ResolvedManifest{
		ServiceOrder: []string{"web", "docs", "api"},
		Services:     map[string]ResolvedService{},
		Stopped:      map[string]ResolvedService{"api": {Name: "api"}, "docs": {Name: "docs"}},
	}

	got := collectServicesHealth(manifest, nil, nil).StoppedServices
	want := []devtools.StoppedService{{Name: "docs"}, {Name: "api"}}
	if !slices.Equal(got, want) {
		t.Fatalf("stopped services = %#v, want %#v", got, want)
	}
}
