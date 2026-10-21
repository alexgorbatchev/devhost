package services

import (
	"strings"
	"testing"
)

func TestGroupSelectionReloadAndRestart(t *testing.T) {
	groups := "[groups]\napp = [\"web\"]\nadmin = [\"docs\"]\n"
	web := strings.Replace(sliceServiceBody("web"), "port = \"auto\"", "dependsOn = [\"api\"]\nport = \"auto\"", 1)
	api := strings.Replace(sliceServiceBody("api"), "port = \"auto\"", "dependsOn = [\"db\"]\nport = \"auto\"", 1)
	body := web + api + sliceServiceBody("db") + sliceServiceBody("docs") + sliceServiceBody("extra") + alwaysStartServiceBody("mail")
	f := startReloadStackRequested(t, groups+body, false, []string{"app", "app"})
	assertSliceHealth(t, f, []string{"web", "api", "db", "mail"}, []string{"docs", "extra"})
	for _, name := range []string{"web", "api", "db", "mail"} {
		route := readRestartRoute(t, sliceRoutePath(f, name))
		assertRestartResponse(t, serverURL(route.AppPort, "/"), name)
	}

	f.write(t, strings.Replace(groups, "app = [\"web\"]", "app = [\"web\", \"docs\"]", 1)+body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 1 })
	assertSliceHealth(t, f, []string{"web", "api", "db", "docs", "mail"}, []string{"extra"})

	if err := f.control.RestartStack(); err != nil {
		t.Fatal(err)
	}
	assertSliceHealth(t, f, []string{"web", "api", "db", "docs", "mail"}, []string{"extra"})

	f.write(t, groups+body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 2 })
	assertSliceHealth(t, f, []string{"web", "api", "db", "mail"}, []string{"docs", "extra"})

	// Invalid membership leaves the accepted selection running.
	f.write(t, strings.Replace(groups, "app = [\"web\"]", "app = [\"missing\"]", 1)+body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.contains("configuration reload rejected") })
	assertSliceHealth(t, f, []string{"web", "api", "db", "mail"}, []string{"docs", "extra"})

	// Removing the selected group leaves only the always-start services.
	f.write(t, "[groups]\nadmin = [\"docs\"]\n"+body)
	waitForCondition(t, stackChangeTimeout, func() bool { return f.logs.count("configuration reloaded") == 3 })
	assertSliceHealth(t, f, []string{"mail"}, []string{"web", "api", "db", "docs", "extra"})
}
