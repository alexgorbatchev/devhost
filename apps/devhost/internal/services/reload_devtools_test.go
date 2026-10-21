package services

import (
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

const allDevtoolsOff = "\n[devtools.chat]\nenabled = false\n[devtools.annotations]\nenabled = false\n[devtools.editor]\nenabled = false\n[devtools.externalToolbars]\nenabled = false\n[devtools.minimap]\nenabled = false\n[devtools.status]\nenabled = false\n"

func TestManifestReloadTurnsDevtoolsInjectionOffAndOn(t *testing.T) {
	body := reloadServiceBody("web", "page", "reload.localhost")
	f := startReloadStack(t, body)
	routePath := filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json")
	route := readRestartRoute(t, routePath)
	pid := reloadPID(t, route.AppPort)
	assertDocumentInjection(t, route.DocumentInjectionPort, true)

	f.write(t, allDevtoolsOff+body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 1 })
	assertDocumentInjection(t, route.DocumentInjectionPort, false)
	if off := readRestartRoute(t, routePath); off.DevtoolsControlPort != 0 || off.DocumentInjectionPort != route.DocumentInjectionPort {
		t.Fatalf("route with every devtools feature off = %#v, want the document route without the control route", off)
	}

	f.write(t, body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 2 })
	assertDocumentInjection(t, route.DocumentInjectionPort, true)
	if on := readRestartRoute(t, routePath); on.DevtoolsControlPort != f.controlPort {
		t.Fatalf("route with devtools back on = %#v, want control port %d", on, f.controlPort)
	}
	if reloadPID(t, route.AppPort) != pid {
		t.Fatal("turning devtools off and on restarted the service")
	}
}

func TestManifestReloadStartsTheIdleTimeout(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	// The test waits for this short timeout to run out.
	f.write(t, "\n[devtools]\nidleTimeout = \"100ms\"\n"+body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("Idle timeout enabled: 100ms") })
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("Idle timeout of 100ms reached") })
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("Stack stopped.") })
}

func assertDocumentInjection(t *testing.T, documentPort int, want bool) {
	t.Helper()
	response, err := http.Get(serverURL(documentPort, "/page"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	text, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Contains(string(text), "/__devhost__/inject.js"); got != want {
		t.Fatalf("document %q carries the devtools: %v, want %v", text, got, want)
	}
}
