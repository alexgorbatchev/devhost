package caddy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

func TestClaimHostDeduplicatesZombieCleanup(t *testing.T) {
	for _, routes := range []int{1, 2} {
		t.Run(fmt.Sprintf("%d routes and host claim", routes), func(t *testing.T) {
			zombie := startZombieProcess(t)
			withRouteMutationTestHooks(t, routeMutationTestHooks{
				now: time.Now(), processID: 4321,
				// A killed owner can remain visible while the OS finishes exiting it.
				processAlive: func(pid int) bool { return pid == 4321 || pid == zombie.pid },
			})
			paths := newManagedCaddyPaths(t)
			kills := observeZombieKills(t)
			const host = "hello.localhost"
			const manifest = "/project/devhost.toml"
			writeZombieClaims(t, paths, zombie.pid, host, manifest, routes)
			var logs bytes.Buffer
			options := ClaimHostOptions{Host: host, ManifestPath: manifest, RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath, KillZombies: true, LogWriter: &logs}
			if err := ClaimHost(options); err != nil {
				t.Fatal(err)
			}
			if got := strings.Count(logs.String(), "Stopped zombie PID"); got != 1 {
				t.Fatalf("exit confirmations = %d, want 1: %s", got, logs.String())
			}
			if got := strings.Count(logs.String(), "Stopping zombie PID"); got != 1 {
				t.Fatalf("kill messages = %d, want 1: %s", got, logs.String())
			}
			if kills[zombie.pid] != 1 {
				t.Fatalf("kill attempts = %d, want 1", kills[zombie.pid])
			}
			if err := ClaimHost(ClaimHostOptions{Host: host, ManifestPath: "/other/devhost.toml", RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath}); err == nil {
				t.Fatal("replacement host claim did not prevent another manifest from claiming the host")
			}
			zombie.assertKilled(t)
		})
	}
}

func TestZombieCleanupAcrossClaims(t *testing.T) {
	for _, sameOwner := range []bool{true, false} {
		t.Run(fmt.Sprintf("same owner %t", sameOwner), func(t *testing.T) {
			first := startZombieProcess(t)
			second := first
			if !sameOwner {
				second = startZombieProcess(t)
			}
			withRouteMutationTestHooks(t, routeMutationTestHooks{
				now: time.Now(), processID: 4321,
				processAlive: func(pid int) bool { return pid == 4321 || pid == first.pid || pid == second.pid },
			})
			kills := observeZombieKills(t)
			paths := newManagedCaddyPaths(t)
			const manifest = "/project/devhost.toml"
			writeZombieClaims(t, paths, first.pid, "first.localhost", manifest, 2)
			writeZombieClaims(t, paths, second.pid, "second.localhost", manifest, 1)
			portClaim, err := json.Marshal(fixedPortClaim{CreatedAt: "2026-10-12T00:00:00Z", BindHost: "127.0.0.1", Port: 3000, ManifestPath: manifest, OwnerPID: first.pid})
			if err != nil {
				t.Fatal(err)
			}
			writeRegistration(t, getFixedPortClaimPath("127.0.0.1", 3000, paths.PortClaimsDirectoryPath), string(portClaim))
			var logs bytes.Buffer
			cleanup := new(ZombieCleanup)
			if err := ClaimFixedPort(ClaimFixedPortOptions{ZombieCleanup: cleanup, BindHost: "127.0.0.1", Port: 3000, ManifestPath: manifest, PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath, KillZombies: true, LogWriter: &logs}); err != nil {
				t.Fatal(err)
			}
			for _, host := range []string{"first.localhost", "second.localhost"} {
				if err := ClaimHost(ClaimHostOptions{ZombieCleanup: cleanup, Host: host, ManifestPath: manifest, RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath, KillZombies: true, LogWriter: &logs}); err != nil {
					t.Fatal(err)
				}
				text, err := os.ReadFile(getHostClaimPath(host, paths.RegistrationsDirectoryPath))
				if err != nil {
					t.Fatal(err)
				}
				claim, err := parseHostClaim(text)
				if err != nil || claim.OwnerPID != 4321 || claim.ManifestPath != manifest {
					t.Fatalf("replacement host claim = %+v, error %v", claim, err)
				}
			}
			for pid, count := range kills {
				if count != 1 {
					t.Fatalf("PID %d kill attempts = %d, want 1", pid, count)
				}
			}
			want := 1
			if !sameOwner {
				want = 2
			}
			if len(kills) != want || strings.Count(logs.String(), "Stopping zombie PID") != want || strings.Count(logs.String(), "Stopped zombie PID") != want {
				t.Fatalf("kills = %v, logs = %q, want %d owners", kills, logs.String(), want)
			}
			text, err := os.ReadFile(getFixedPortClaimPath("127.0.0.1", 3000, paths.PortClaimsDirectoryPath))
			if err != nil {
				t.Fatal(err)
			}
			claim, err := parseFixedPortClaim(text)
			if err != nil || claim.OwnerPID != 4321 || claim.ManifestPath != manifest {
				t.Fatalf("replacement port claim = %+v, error %v", claim, err)
			}
			first.assertKilled(t)
			if !sameOwner {
				second.assertKilled(t)
			}
		})
	}
}

func observeZombieKills(t *testing.T) map[int]int {
	t.Helper()
	original := routeMutationKillProcess
	kills := make(map[int]int)
	routeMutationKillProcess = func(pid int) error {
		kills[pid]++
		return original(pid)
	}
	t.Cleanup(func() { routeMutationKillProcess = original })
	return kills
}

func TestZombieCleanupFailurePreservesClaims(t *testing.T) {
	for _, failure := range []string{"kill", "exit confirmation"} {
		for _, kind := range []string{"host", "route", "fixed port"} {
			t.Run(failure+"/"+kind, func(t *testing.T) {
				zombie := startZombieProcess(t)
				withRouteMutationTestHooks(t, routeMutationTestHooks{now: time.Now(), processID: 4321,
					processAlive: func(pid int) bool { return pid == 4321 || pid == zombie.pid },
				})
				originalKill, originalWait := routeMutationKillProcess, routeMutationWaitZombieExit
				t.Cleanup(func() { routeMutationKillProcess, routeMutationWaitZombieExit = originalKill, originalWait })
				wantErr := error(syscall.EPERM)
				attempts := 0
				routeMutationKillProcess = func(pid int) error {
					attempts++
					if failure == "kill" {
						return wantErr
					}
					return originalKill(pid)
				}
				if failure == "exit confirmation" {
					wantErr = context.DeadlineExceeded
					routeMutationWaitZombieExit = func(context.Context, zombieOwner) error { return wantErr }
				}
				paths := newManagedCaddyPaths(t)
				const manifest = "/project/devhost.toml"
				const host = "hello.localhost"
				cleanup := new(ZombieCleanup)
				var logs bytes.Buffer
				claimPath := getHostClaimPath(host, paths.RegistrationsDirectoryPath)
				claim := func() error {
					return ClaimHost(ClaimHostOptions{ZombieCleanup: cleanup, Host: host, ManifestPath: manifest, RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath, KillZombies: true, LogWriter: &logs})
				}
				writeZombieClaims(t, paths, zombie.pid, host, manifest, 0)
				if kind == "route" {
					writeZombieClaims(t, paths, zombie.pid, host, manifest, 1)
					claimPath = filepath.Join(paths.RegistrationsDirectoryPath, host+"_0.json")
				}
				if kind == "fixed port" {
					claimPath = getFixedPortClaimPath("127.0.0.1", 3000, paths.PortClaimsDirectoryPath)
					body, err := json.Marshal(fixedPortClaim{CreatedAt: "2026-10-12T00:00:00Z", BindHost: "127.0.0.1", Port: 3000, ManifestPath: manifest, OwnerPID: zombie.pid})
					if err != nil {
						t.Fatal(err)
					}
					writeRegistration(t, claimPath, string(body))
					claim = func() error {
						return ClaimFixedPort(ClaimFixedPortOptions{ZombieCleanup: cleanup, BindHost: "127.0.0.1", Port: 3000, ManifestPath: manifest, PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath, KillZombies: true, LogWriter: &logs})
					}
				}
				before, err := os.ReadFile(claimPath)
				if err != nil {
					t.Fatal(err)
				}
				for range 2 {
					if err := claim(); !errors.Is(err, wantErr) {
						t.Fatalf("claim error = %v, want %v", err, wantErr)
					}
				}
				after, err := os.ReadFile(claimPath)
				if err != nil || !bytes.Equal(before, after) {
					t.Fatalf("claim changed on cleanup failure: %s, error %v", after, err)
				}
				if attempts != 1 || strings.Count(logs.String(), "Stopping zombie PID") != 1 || strings.Contains(logs.String(), "Stopped zombie PID") {
					t.Fatalf("attempts = %d, logs = %q", attempts, logs.String())
				}
			})
		}
	}
}

func TestWaitZombieExit(t *testing.T) {
	zombie := startZombieProcess(t)
	owner := zombieOwner{pid: zombie.pid}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitZombieExit(ctx, owner); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait on live process = %v, want cancellation", err)
	}
	if exited, err := zombieExited(context.Background(), owner); err != nil || exited {
		t.Fatalf("live process exited = %t, error %v", exited, err)
	}
	identity, err := procid.StartIdentity(zombie.pid)
	if err != nil {
		t.Fatal(err)
	}
	if exited, err := zombieExited(context.Background(), zombieOwner{pid: zombie.pid, startIdentity: identity}); err != nil || exited {
		t.Fatalf("matching live identity exited = %t, error %v", exited, err)
	}
	if exited, err := zombieExited(context.Background(), zombieOwner{pid: zombie.pid, startIdentity: identity + "-previous"}); err != nil || !exited {
		t.Fatalf("replaced identity exited = %t, error %v", exited, err)
	}
	if err := routeMutationKillProcess(zombie.pid); err != nil {
		t.Fatal(err)
	}
	ctx, cancel = context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := waitZombieExit(ctx, owner); err != nil {
		t.Fatal(err)
	}
	zombie.assertKilled(t)
}

func TestZombieCleanupConfirmsUnreapedExit(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("unreaped Unix process state")
	}
	command := exec.Command("sleep", "300")
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = command.Process.Kill(); _ = command.Wait() })
	var logs bytes.Buffer
	originalWait := routeMutationWaitZombieExit
	t.Cleanup(func() { routeMutationWaitZombieExit = originalWait })
	routeMutationWaitZombieExit = func(ctx context.Context, owner zombieOwner) error {
		if !strings.Contains(logs.String(), "Stopping zombie PID") || strings.Contains(logs.String(), "Stopped zombie PID") {
			t.Fatalf("logs before exit confirmation = %q", logs.String())
		}
		return originalWait(ctx, owner)
	}
	if err := new(ZombieCleanup).kill(command.Process.Pid, "", "hello.localhost", &logs); err != nil {
		t.Fatal(err)
	}
	// The parent has not waited yet: a signal probe still sees this exited PID.
	if err := command.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatalf("unreaped process probe: %v", err)
	}
	if !strings.Contains(logs.String(), "Stopped zombie PID") {
		t.Fatalf("missing exit confirmation: %s", logs.String())
	}
}

func writeZombieClaims(t *testing.T, paths Paths, pid int, host, manifest string, routes int) {
	t.Helper()
	claim, err := json.Marshal(hostClaim{CreatedAt: "2026-10-12T00:00:00Z", Host: host, ManifestPath: manifest, OwnerPID: pid})
	if err != nil {
		t.Fatal(err)
	}
	writeRegistration(t, getHostClaimPath(host, paths.RegistrationsDirectoryPath), string(claim))
	for i := range routes {
		route, err := json.Marshal(routeRegistration{CreatedAt: "2026-10-12T00:00:00Z", Host: host, ManifestPath: manifest, OwnerPID: pid, AppBindHost: "127.0.0.1", AppPort: 4000, Path: fmt.Sprintf("/api%d/*", i), ServiceName: "api"})
		if err != nil {
			t.Fatal(err)
		}
		writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, fmt.Sprintf("%s_%d.json", host, i)), string(route))
	}
}
