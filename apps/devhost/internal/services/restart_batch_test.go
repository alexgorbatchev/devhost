package services

import (
	"strings"
	"testing"
)

func TestRestartBatchDeduplicatesInDependencyOrder(t *testing.T) {
	body := reloadServiceBody("base", "base", "base.localhost") +
		strings.Replace(reloadServiceBody("web", "web", "web.localhost"), "command = ", "dependsOn = [\"base\"]\ncommand = ", 1)
	f := startReloadStack(t, body)
	if err := f.control.RestartService([]string{"web", "missing", "base"}); err == nil {
		t.Fatal("invalid batch succeeded")
	}
	if f.logs.count("restarting service:") != 0 {
		t.Fatal("invalid batch restarted a service")
	}
	if err := f.control.RestartService([]string{"web", "base", "web", "base"}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"base", "web"} {
		if count := f.logs.count("restarting service: " + name); count != 1 {
			t.Fatalf("%s restarted %d times, want 1", name, count)
		}
	}
	f.logs.mu.Lock()
	log := f.logs.text.String()
	f.logs.mu.Unlock()
	if strings.Index(log, "restarting service: base") > strings.Index(log, "restarting service: web") {
		t.Fatal("dependent restarted before its dependency")
	}
}
