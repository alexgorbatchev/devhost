package caddy

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestRegisterStackMakesTheStackKnownUntilItUnregisters(t *testing.T) {
	paths := newManagedCaddyPaths(t)
	options := RegisterStackOptions{
		ManifestPath:        identityTestManifestPath,
		StackName:           "hello-stack",
		StacksDirectoryPath: paths.StacksDirectoryPath,
	}

	if err := RegisterStack(options); err != nil {
		t.Fatalf("RegisterStack() unexpected error = %v", err)
	}

	got, err := ReadLiveStackOwners(paths)
	if err != nil {
		t.Fatalf("ReadLiveStackOwners() unexpected error = %v", err)
	}
	if want := []StackOwner{{ManifestPath: identityTestManifestPath, PID: os.Getpid()}}; !slices.Equal(got, want) {
		t.Fatalf("ReadLiveStackOwners() = %#v, want %#v", got, want)
	}

	// Registering again replaces the record instead of failing on it.
	if err := RegisterStack(options); err != nil {
		t.Fatalf("RegisterStack() again unexpected error = %v", err)
	}

	if err := UnregisterStack(paths.StacksDirectoryPath); err != nil {
		t.Fatalf("UnregisterStack() unexpected error = %v", err)
	}

	got, err = ReadLiveStackOwners(paths)
	if err != nil {
		t.Fatalf("ReadLiveStackOwners() after unregistering unexpected error = %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("ReadLiveStackOwners() after unregistering = %#v, want no owners", got)
	}

	// A stack that failed before it registered unregisters during its cleanup too.
	if err := UnregisterStack(paths.StacksDirectoryPath); err != nil {
		t.Fatalf("UnregisterStack() without a record unexpected error = %v", err)
	}
}

func TestRegisterStackRecordsTheStackItRuns(t *testing.T) {
	paths := newManagedCaddyPaths(t)

	if err := RegisterStack(RegisterStackOptions{
		ManifestPath:        identityTestManifestPath,
		StackName:           "hello-stack",
		StacksDirectoryPath: paths.StacksDirectoryPath,
	}); err != nil {
		t.Fatalf("RegisterStack() unexpected error = %v", err)
	}

	entries, err := os.ReadDir(paths.StacksDirectoryPath)
	if err != nil {
		t.Fatalf("ReadDir(...) error = %v", err)
	}
	// One record, and no temporary file left beside it.
	if len(entries) != 1 {
		t.Fatalf("stack records directory holds %d entries, want 1", len(entries))
	}

	recordText, err := os.ReadFile(filepath.Join(paths.StacksDirectoryPath, entries[0].Name()))
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	record, err := parseStackRecord(recordText)
	if err != nil {
		t.Fatalf("parseStackRecord() unexpected error = %v", err)
	}

	if record.ManifestPath != identityTestManifestPath || record.StackName != "hello-stack" || record.OwnerPID != os.Getpid() {
		t.Fatalf("stack record = %#v, want the manifest, name, and PID of this stack", record)
	}
	if want := readStartIdentity(t, os.Getpid()); record.OwnerStartIdentity != want {
		t.Fatalf("stack record start identity = %q, want %q", record.OwnerStartIdentity, want)
	}
}

func TestCleanupStaleStackRecordsRemovesTheRecordsOfStacksThatExited(t *testing.T) {
	// A running process this test owns: the owner of one record, and the unrelated
	// process that got the PID of the owner of another.
	process := startZombieProcess(t)
	paths := newManagedCaddyPaths(t)

	var stackRecordKind ownedRecord
	for _, record := range ownedRecords() {
		if record.kind == "stack record" {
			stackRecordKind = record
		}
	}

	runningRecordPath := filepath.Join(paths.StacksDirectoryPath, "running.json")
	exitedRecordPath := filepath.Join(paths.StacksDirectoryPath, "exited.json")
	writeRegistration(t, runningRecordPath, stackRecordKind.text(process.pid, readStartIdentity(t, process.pid)))
	writeRegistration(t, exitedRecordPath, stackRecordKind.text(process.pid, exitedOwnerStartIdentity))

	if err := CleanupStaleStackRecords(paths.StacksDirectoryPath); err != nil {
		t.Fatalf("CleanupStaleStackRecords() unexpected error = %v", err)
	}

	if _, err := os.Stat(runningRecordPath); err != nil {
		t.Fatalf("record of the running stack: %v, want it kept", err)
	}
	if _, err := os.Stat(exitedRecordPath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("record of the exited stack: %v, want it removed", err)
	}
}
