//go:build linux || darwin

package caddy

import (
	"errors"
	"os"
	"os/exec"
	"slices"
	"syscall"
	"testing"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

func TestUnreapedOwnerDoesNotKeepStacksOrClaimsAlive(t *testing.T) {
	for _, withIdentity := range []bool{true, false} {
		name := "with start identity"
		if !withIdentity {
			name = "without start identity"
		}
		t.Run(name, func(t *testing.T) {
			command := exec.Command("sleep", "60")
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_ = command.Process.Kill() // Best-effort cleanup if the test fails before killing it.
				_ = command.Wait()         // Reap only after assertions have observed the zombie.
			})
			pid := command.Process.Pid
			identity := ""
			if withIdentity {
				identity = readStartIdentity(t, pid)
			}
			paths := newManagedCaddyPaths(t)
			for _, record := range ownedRecords() {
				writeOwnedRecord(t, paths, record, pid, identity)
			}
			owners, err := ReadLiveStackOwners(paths)
			if err != nil || len(owners) != 1 {
				t.Fatalf("running owners = %v, error = %v; want one", owners, err)
			}
			stacks, err := ReadLiveStacks(paths)
			if err != nil || len(stacks) != 1 || !stacks[0].Alive() {
				t.Fatalf("running stacks = %v, error = %v; want one live stack", stacks, err)
			}
			if err := command.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			waitUnreapedOwner(t, pid)
			if err := syscall.Kill(pid, 0); err != nil {
				t.Fatalf("unreaped child no longer answers signal 0: %v", err)
			}
			if stacks[0].Alive() {
				t.Fatal("exited, unreaped stack is still alive")
			}
			owners, err = ReadLiveStackOwners(paths)
			if err != nil || len(owners) != 0 {
				t.Fatalf("unreaped owners = %v, error = %v; want none", owners, err)
			}
			stacks, err = ReadLiveStacks(paths)
			if err != nil || len(stacks) != 0 {
				t.Fatalf("unreaped stacks = %v, error = %v; want none", stacks, err)
			}
			if err := CleanupStaleStackRecords(paths.StacksDirectoryPath); err != nil {
				t.Fatal(err)
			}
			for _, record := range ownedRecords() {
				if record.kind == "stack record" {
					if _, err := os.Stat(record.path(paths)); !errors.Is(err, os.ErrNotExist) {
						t.Fatalf("unreaped stack record remains: %v", err)
					}
				}
			}
			if err := ClaimHost(ClaimHostOptions{Host: identityTestHost, ManifestPath: "/other/devhost.toml", RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath}); err != nil {
				t.Fatalf("reclaim unreaped owner's hostname: %v", err)
			}
			if err := ClaimFixedPort(ClaimFixedPortOptions{BindHost: "127.0.0.1", Port: identityTestPort, ManifestPath: "/other/devhost.toml", PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath}); err != nil {
				t.Fatalf("reclaim unreaped owner's port: %v", err)
			}
		})
	}
}

func waitUnreapedOwner(t *testing.T, pid int) {
	t.Helper()
	p, err := process.NewProcess(int32(pid))
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		statuses, err := p.Status()
		if err != nil {
			t.Fatal(err)
		}
		if slices.Contains(statuses, process.Zombie) {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("killed child did not become an unreaped zombie")
}
