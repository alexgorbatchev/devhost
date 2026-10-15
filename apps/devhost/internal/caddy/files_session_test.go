package caddy

import (
	"os"
	"testing"
)

func TestFilesSessionHasNoManifestOwnership(t *testing.T) {
	paths := newManagedCaddyPaths(t)
	if err := RegisterStack(RegisterStackOptions{StackName: "files", StacksDirectoryPath: paths.StacksDirectoryPath}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(getStackRecordPath(paths.StacksDirectoryPath))
	if err != nil {
		t.Fatal(err)
	}
	record, err := parseStackRecord(data)
	if err != nil {
		t.Fatal(err)
	}
	if record.ManifestPath != "" || len(record.ManifestFiles) != 0 {
		t.Fatalf("file session claimed manifests: %#v", record)
	}
	owners, err := ReadLiveStackOwners(paths)
	if err != nil {
		t.Fatal(err)
	}
	if len(owners) != 0 {
		t.Fatalf("manifest owners include file session: %#v", owners)
	}
	if err := UnregisterStack(paths.StacksDirectoryPath); err != nil {
		t.Fatal(err)
	}
}
