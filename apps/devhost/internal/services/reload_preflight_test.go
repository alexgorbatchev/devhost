package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestManifestReloadRejectsMissingWorkingDirectoryBeforeStoppingServices(t *testing.T) {
	f := startReloadStack(t, reloadServiceBody("web", "original", "reload.localhost"))
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	pid := reloadPID(t, route.AppPort)
	body := reloadServiceBody("web", "changed", "reload.localhost")
	body = strings.Replace(body, "[services.web]", "[services.web]\ncwd = \"missing\"", 1)
	f.write(t, body)
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reload rejected") })
	if reloadPID(t, route.AppPort) != pid {
		t.Fatal("invalid working directory stopped the previous service")
	}
}

func TestManifestReloadRebindsAllTemplatesAndEnvironmentsAfterAutoPortRetry(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost") + reloadServiceBody("api", "api", "api.localhost") + "REFERENCE = \"{{ services.web.port }}\"\n"
	f := startReloadStack(t, body)
	original := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	marker := filepath.Join(filepath.Dir(f.path), "collision")
	next := strings.Replace(body, "VALUE = \"original\"", fmt.Sprintf("VALUE = \"replacement\"\nCOLLISION_MARKER = %q", marker), 1)
	f.write(t, next)
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reloaded") })
	web := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
	api := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "api.localhost_api_2f.json"))
	if web.AppPort == original.AppPort {
		t.Fatal("collision did not reassign auto port")
	}
	response, err := http.Get(serverURL(api.AppPort, "/env"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var env map[string]string
	if err := json.NewDecoder(response.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprint(web.AppPort)
	if env["WEB"] != want || env["REFERENCE"] != want {
		t.Fatalf("dependent retained stale ports: %#v; want %s", env, want)
	}
}
