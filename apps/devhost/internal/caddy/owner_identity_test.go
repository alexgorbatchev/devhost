package caddy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

const (
	identityTestManifestPath = "/tmp/project/devhost.toml"
	identityTestHost         = "hello.localhost"
	identityTestPort         = 5432
	// The start identity of a stack that has exited, whose PID a later process got.
	exitedOwnerStartIdentity = "exited-owner"
)

// ownedRecord is a record of one kind, written as the stack that owns it would
// have written it.
type ownedRecord struct {
	kind string
	path func(paths Paths) string
	// text renders the record for an owner; an empty start identity leaves the
	// field out, as a devhost that predates it did.
	text func(ownerPID int, ownerStartIdentity string) string
}

func ownedRecords() []ownedRecord {
	render := func(fields map[string]any, ownerPID int, ownerStartIdentity string) string {
		fields["createdAt"] = "2026-04-19T12:34:56.000Z"
		fields["manifestPath"] = identityTestManifestPath
		fields["ownerPid"] = ownerPID
		if ownerStartIdentity != "" {
			fields["ownerStartIdentity"] = ownerStartIdentity
		}
		text, _ := json.Marshal(fields) // Primitive-only fields cannot fail JSON marshaling.
		return string(text)
	}

	return []ownedRecord{
		{
			kind: "host claim",
			path: func(paths Paths) string {
				return getHostClaimPath(identityTestHost, paths.RegistrationsDirectoryPath)
			},
			text: func(ownerPID int, ownerStartIdentity string) string {
				return render(map[string]any{"host": identityTestHost}, ownerPID, ownerStartIdentity)
			},
		},
		{
			kind: "fixed port claim",
			path: func(paths Paths) string {
				return getFixedPortClaimPath("127.0.0.1", identityTestPort, paths.PortClaimsDirectoryPath)
			},
			text: func(ownerPID int, ownerStartIdentity string) string {
				return render(map[string]any{"bindHost": "127.0.0.1", "port": identityTestPort}, ownerPID, ownerStartIdentity)
			},
		},
		{
			kind: "stack record",
			path: func(paths Paths) string {
				return filepath.Join(paths.StacksDirectoryPath, "recorded.json")
			},
			text: func(ownerPID int, ownerStartIdentity string) string {
				return render(map[string]any{"stackName": "hello-stack"}, ownerPID, ownerStartIdentity)
			},
		},
		{
			kind: "route registration",
			path: func(paths Paths) string {
				return getRouteRegistrationPath("api", identityTestHost, "/", paths.RoutesDirectoryPath)
			},
			text: func(ownerPID int, ownerStartIdentity string) string {
				return render(map[string]any{
					"appBindHost": "127.0.0.1",
					"appPort":     4000,
					"host":        identityTestHost,
					"path":        "/",
					"serviceName": "api",
				}, ownerPID, ownerStartIdentity)
			},
		},
	}
}

func writeOwnedRecord(t *testing.T, paths Paths, record ownedRecord, ownerPID int, ownerStartIdentity string) {
	t.Helper()

	recordPath := record.path(paths)
	if err := os.MkdirAll(filepath.Dir(recordPath), 0o755); err != nil {
		t.Fatalf("create record directory: %v", err)
	}
	writeRegistration(t, recordPath, record.text(ownerPID, ownerStartIdentity))
}

func readStartIdentity(t *testing.T, pid int) string {
	t.Helper()

	identity, err := procid.StartIdentity(pid)
	if err != nil {
		t.Fatalf("StartIdentity(%d) unexpected error = %v", pid, err)
	}

	return identity
}

func (z *zombieProcess) assertRunning(t *testing.T) {
	t.Helper()

	select {
	case err := <-z.exited:
		t.Fatalf("process %d was ended (%v), want it left running", z.pid, err)
	default:
	}
}

func TestReadLiveStackOwnersTellsAnOwnerFromAProcessThatReusedItsPID(t *testing.T) {
	// A running process this test owns. It stands for the stack that wrote a
	// record, and for an unrelated process that later got the PID of one.
	process := startZombieProcess(t)

	tests := []struct {
		name               string
		ownerStartIdentity string
		wantOwners         []StackOwner
	}{
		{
			name:               "the owner is still running",
			ownerStartIdentity: readStartIdentity(t, process.pid),
			wantOwners:         []StackOwner{{ManifestPath: identityTestManifestPath, PID: process.pid}},
		},
		{
			name:               "another process has the PID of an owner that exited",
			ownerStartIdentity: exitedOwnerStartIdentity,
			wantOwners:         []StackOwner{},
		},
		{
			name:               "the record predates start identities",
			ownerStartIdentity: "",
			wantOwners:         []StackOwner{{ManifestPath: identityTestManifestPath, PID: process.pid}},
		},
	}

	for _, record := range ownedRecords() {
		for _, tc := range tests {
			t.Run(record.kind+": "+tc.name, func(t *testing.T) {
				paths := newManagedCaddyPaths(t)
				writeOwnedRecord(t, paths, record, process.pid, tc.ownerStartIdentity)

				got, err := ReadLiveStackOwners(paths)
				if err != nil {
					t.Fatalf("ReadLiveStackOwners() unexpected error = %v", err)
				}

				if !slices.Equal(got, tc.wantOwners) {
					t.Fatalf("ReadLiveStackOwners() = %#v, want %#v", got, tc.wantOwners)
				}
			})
		}
	}
}

// A stack that restarts kills what still holds its claims. When the holder
// exited and its PID went to an unrelated process, that process must survive.
func TestClaimsLeaveAProcessThatReusedTheOwnerPIDRunning(t *testing.T) {
	tests := []struct {
		name  string
		kinds []string
		claim func(paths Paths, logWriter *bytes.Buffer) error
	}{
		{
			name:  "host",
			kinds: []string{"host claim", "route registration"},
			claim: func(paths Paths, logWriter *bytes.Buffer) error {
				return ClaimHost(ClaimHostOptions{
					Host:                       identityTestHost,
					ManifestPath:               identityTestManifestPath,
					RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
					KillZombies:                true,
					LogWriter:                  logWriter,
				})
			},
		},
		{
			name:  "fixed port",
			kinds: []string{"fixed port claim"},
			claim: func(paths Paths, logWriter *bytes.Buffer) error {
				return ClaimFixedPort(ClaimFixedPortOptions{
					BindHost:                "127.0.0.1",
					Port:                    identityTestPort,
					ManifestPath:            identityTestManifestPath,
					PortClaimsDirectoryPath: paths.PortClaimsDirectoryPath,
					KillZombies:             true,
					LogWriter:               logWriter,
				})
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			unrelated := startZombieProcess(t)
			paths := newManagedCaddyPaths(t)
			for _, record := range ownedRecords() {
				if slices.Contains(tc.kinds, record.kind) {
					writeOwnedRecord(t, paths, record, unrelated.pid, exitedOwnerStartIdentity)
				}
			}

			var log bytes.Buffer
			if err := tc.claim(paths, &log); err != nil {
				t.Fatalf("claim unexpected error = %v", err)
			}

			if log.String() != "" {
				t.Fatalf("claim logged %q, want nothing killed", log.String())
			}
			unrelated.assertRunning(t)

			// The claim now belongs to this process.
			got, err := ReadLiveStackOwners(paths)
			if err != nil {
				t.Fatalf("ReadLiveStackOwners() unexpected error = %v", err)
			}
			if want := []StackOwner{{ManifestPath: identityTestManifestPath, PID: os.Getpid()}}; !slices.Equal(got, want) {
				t.Fatalf("ReadLiveStackOwners() = %#v, want %#v", got, want)
			}
		})
	}
}

func TestClaimHostReportsAHostHeldByARunningOwner(t *testing.T) {
	owner := startZombieProcess(t)
	paths := newManagedCaddyPaths(t)
	for _, record := range ownedRecords() {
		if record.kind == "host claim" {
			writeOwnedRecord(t, paths, record, owner.pid, readStartIdentity(t, owner.pid))
		}
	}

	err := ClaimHost(ClaimHostOptions{
		Host:                       identityTestHost,
		ManifestPath:               "/tmp/other/devhost.toml",
		RegistrationsDirectoryPath: paths.RegistrationsDirectoryPath,
	})

	if want := fmt.Sprintf("%s is already claimed by PID %d from %s.", identityTestHost, owner.pid, identityTestManifestPath); err == nil || err.Error() != want {
		t.Fatalf("ClaimHost() error = %v, want %q", err, want)
	}
	owner.assertRunning(t)
}
