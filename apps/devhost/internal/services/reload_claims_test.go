package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/hashicorp/consul/sdk/freeport"
)

func TestManifestReloadRejectsClaimConflictsBeforeStoppingServices(t *testing.T) {
	for _, kind := range []string{"host", "port"} {
		t.Run(kind, func(t *testing.T) {
			body := reloadServiceBody("web", "original", "reload.localhost")
			f := startReloadStack(t, body)
			route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "reload.localhost_web_2f.json"))
			pid := reloadPID(t, route.AppPort)
			port := freeport.GetOne(t)
			if kind == "host" {
				claim := caddy.ClaimHostOptions{Host: "worker.localhost", ManifestPath: "/other/devhost.toml", RegistrationsDirectoryPath: f.paths.RegistrationsDirectoryPath}
				if err := caddy.ClaimHost(claim); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if err := caddy.ReleaseHostClaim(claim); err != nil {
						t.Error(err)
					}
				})
			} else {
				claim := caddy.ClaimFixedPortOptions{BindHost: "127.0.0.1", Port: port, ManifestPath: "/other/devhost.toml", PortClaimsDirectoryPath: f.paths.PortClaimsDirectoryPath}
				if err := caddy.ClaimFixedPort(claim); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if err := caddy.ReleaseFixedPortClaim(claim); err != nil {
						t.Error(err)
					}
				})
			}
			worker := strings.ReplaceAll(reloadServiceBody("worker", "worker", "worker.localhost"), "port = \"auto\"", fmt.Sprintf("port = %d", port))
			f.write(t, body+worker)
			waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reload rejected") })
			if reloadPID(t, route.AppPort) != pid {
				t.Fatal("claim conflict stopped a healthy service")
			}
			if kind == "host" {
				claims, err := os.ReadDir(f.paths.PortClaimsDirectoryPath)
				if err != nil || len(claims) != 0 {
					t.Fatalf("candidate fixed-port claim leaked: %#v, %v", claims, err)
				}
			}
		})
	}
}

func TestManifestReloadShutdownCleansDynamicallyAddedResources(t *testing.T) {
	body := reloadServiceBody("web", "original", "reload.localhost")
	f := startReloadStack(t, body)
	port := freeport.GetOne(t)
	worker := strings.ReplaceAll(reloadServiceBody("worker", "worker", "worker.localhost"), "port = \"auto\"", fmt.Sprintf("port = %d", port))
	f.write(t, body+worker)
	waitForCondition(t, 5*time.Second, func() bool { return f.logs.contains("configuration reloaded") })
	assertRestartResponse(t, serverURL(port, "/"), "worker")
	route := readRestartRoute(t, filepath.Join(f.paths.RegistrationsDirectoryPath, "worker.localhost_worker_2f.json"))
	f.stop()
	if canConnectToPort(context.Background(), "127.0.0.1", port, minProbeTimeout) || canConnectToPort(context.Background(), "127.0.0.1", route.DocumentInjectionPort, minProbeTimeout) {
		t.Fatal("shutdown retained added service listeners")
	}
	for _, dir := range []string{f.paths.RegistrationsDirectoryPath, f.paths.HostClaimsDirectoryPath, f.paths.PortClaimsDirectoryPath} {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) != 0 {
			t.Errorf("shutdown retained reload resources in %s: %#v, %v", dir, entries, err)
		}
	}
}
