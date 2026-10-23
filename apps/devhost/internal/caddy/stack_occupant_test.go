package caddy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"syscall"
	"testing"
)

func TestStackOccupantsMatchInputsAndLiveRoutes(t *testing.T) {
	paths := newManagedCaddyPaths(t)
	owner := startZombieProcess(t)
	shared := filepath.Join(t.TempDir(), "shared.toml")
	if err := os.WriteFile(shared, nil, 0600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "alias.toml")
	if err := os.Symlink(shared, alias); err != nil {
		t.Fatal(err)
	}
	r := stackRecord{CreatedAt: "now", ManifestPath: identityTestManifestPath, ManifestFiles: []string{shared}, OwnerPID: owner.pid, OwnerStartIdentity: readStartIdentity(t, owner.pid), StackName: "storybook"}
	writeOccupantRecord(t, paths, r)
	for i, route := range []routeRegistration{
		{OwnerPID: owner.pid, OwnerStartIdentity: r.OwnerStartIdentity, Host: "storybook.localhost", Path: "/ui/*"},
		{OwnerPID: owner.pid, OwnerStartIdentity: "previous-process", Host: "stale.localhost", Path: "/"},
	} {
		route.CreatedAt, route.ManifestPath, route.ServiceName, route.AppBindHost, route.AppPort = "now", r.ManifestPath, "web", "127.0.0.1", 4000
		data, err := json.Marshal(route)
		if err != nil {
			t.Fatal(err)
		}
		writeRegistration(t, filepath.Join(paths.RegistrationsDirectoryPath, strconv.Itoa(i)+".json"), string(data))
	}
	owners, err := ReadStackOccupants(paths, []string{alias})
	if err != nil || len(owners) != 1 {
		t.Fatalf("owners = %#v, %v", owners, err)
	}
	got := owners[0]
	if got.PID != owner.pid || got.Name != "storybook" || !reflect.DeepEqual(got.URLs, []string{"https://storybook.localhost/ui/"}) {
		t.Fatalf("owner details = %#v", got)
	}
	r.CreatedAt = "replacement"
	writeOccupantRecord(t, paths, r)
	if err := got.Signal(paths, syscall.SIGTERM); err == nil {
		t.Fatal("stale action signaled a re-registered stack")
	}
	if !got.Alive() {
		t.Fatal("stale action stopped the owner")
	}
	owners, err = ReadStackOccupants(paths, []string{shared})
	if err != nil || len(owners) != 1 {
		t.Fatalf("refresh = %#v, %v", owners, err)
	}
	if err := owners[0].Signal(paths, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	owner.assertKilled(t)
	owners, err = ReadStackOccupants(paths, []string{shared})
	if err != nil || len(owners) != 0 {
		t.Fatalf("exited owners = %#v, %v", owners, err)
	}
}

func TestStackOccupantsIgnoreSelfAndReusedPIDs(t *testing.T) {
	for _, state := range []string{"self", "reused PID"} {
		t.Run(state, func(t *testing.T) {
			paths := newManagedCaddyPaths(t)
			r := stackRecord{CreatedAt: "now", ManifestPath: identityTestManifestPath, OwnerPID: os.Getpid(), OwnerStartIdentity: readStartIdentity(t, os.Getpid()), StackName: "self"}
			if state == "reused PID" {
				owner := startZombieProcess(t)
				r.OwnerPID, r.OwnerStartIdentity = owner.pid, "exited-process"
			}
			writeOccupantRecord(t, paths, r)
			owners, err := ReadStackOccupants(paths, []string{r.ManifestPath})
			if err != nil || len(owners) != 0 {
				t.Fatalf("owners = %#v, %v", owners, err)
			}
		})
	}
}

func writeOccupantRecord(t *testing.T, paths Paths, r stackRecord) {
	t.Helper()
	data, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	writeRegistration(t, filepath.Join(paths.StacksDirectoryPath, strconv.Itoa(r.OwnerPID)+".json"), string(data))
}
