package devtools

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestWriteFileDurablySyncsAndRenames(t *testing.T) {
	originalOpenFile := durableOpenFile
	originalRenameFile := durableRenameFile
	originalSyncFile := durableSyncFile
	originalSyncDirectory := durableSyncDirectory
	defer func() {
		durableOpenFile = originalOpenFile
		durableRenameFile = originalRenameFile
		durableSyncFile = originalSyncFile
		durableSyncDirectory = originalSyncDirectory
	}()

	filePath := filepath.Join(t.TempDir(), "queues", "state.json")
	callOrder := []string{}
	targetDirectoryPath := filepath.Dir(filePath)
	durableRenameFile = func(oldPath string, newPath string) error {
		if filepath.Dir(newPath) == targetDirectoryPath {
			callOrder = append(callOrder, "rename")
		}
		return originalRenameFile(oldPath, newPath)
	}
	durableSyncFile = func(file *os.File) error {
		if filepath.Dir(file.Name()) == targetDirectoryPath {
			callOrder = append(callOrder, "file-sync")
		}
		return originalSyncFile(file)
	}
	durableSyncDirectory = func(directoryPath string) error {
		if directoryPath == targetDirectoryPath {
			callOrder = append(callOrder, "dir-sync")
		}
		return originalSyncDirectory(directoryPath)
	}

	payload := []byte(`{"version":1}`)
	if err := writeFileDurably(filePath, payload, 0o600); err != nil {
		t.Fatalf("writeFileDurably(...) error = %v", err)
	}

	if !slices.Equal(callOrder, []string{"file-sync", "rename", "dir-sync"}) {
		t.Fatalf("call order = %#v, want file-sync -> rename -> dir-sync", callOrder)
	}

	storedPayload, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("ReadFile(...) error = %v", err)
	}
	if string(storedPayload) != string(payload) {
		t.Fatalf("stored payload = %q, want %q", string(storedPayload), string(payload))
	}

	entries, err := os.ReadDir(filepath.Dir(filePath))
	if err != nil {
		t.Fatalf("ReadDir(...) error = %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "state.json" {
		t.Fatalf("directory entries = %#v, want only state.json", entries)
	}

	info, err := os.Stat(filePath)
	if err != nil {
		t.Fatalf("Stat(...) error = %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %#o, want 0o600", info.Mode().Perm())
	}
}

func TestRemoveFileDurablyRemovesFileAndSyncsDirectory(t *testing.T) {
	originalRemoveFile := durableRemoveFile
	originalSyncDirectory := durableSyncDirectory
	defer func() {
		durableRemoveFile = originalRemoveFile
		durableSyncDirectory = originalSyncDirectory
	}()

	filePath := filepath.Join(t.TempDir(), "queues", "state.json")
	callOrder := []string{}
	targetDirectoryPath := filepath.Dir(filePath)
	durableRemoveFile = func(filePath string) error {
		if filepath.Dir(filePath) == targetDirectoryPath {
			callOrder = append(callOrder, "remove")
		}
		return originalRemoveFile(filePath)
	}
	durableSyncDirectory = func(directoryPath string) error {
		if directoryPath == targetDirectoryPath {
			callOrder = append(callOrder, "dir-sync")
		}
		return originalSyncDirectory(directoryPath)
	}

	if err := os.MkdirAll(filepath.Dir(filePath), 0o755); err != nil {
		t.Fatalf("MkdirAll(...) error = %v", err)
	}
	if err := os.WriteFile(filePath, []byte("{}"), 0o600); err != nil {
		t.Fatalf("WriteFile(...) error = %v", err)
	}

	if err := removeFileDurably(filePath); err != nil {
		t.Fatalf("removeFileDurably(...) error = %v", err)
	}

	if !slices.Equal(callOrder, []string{"remove", "dir-sync"}) {
		t.Fatalf("call order = %#v, want remove -> dir-sync", callOrder)
	}

	if _, err := os.Stat(filePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Stat(...) error = %v, want os.ErrNotExist", err)
	}
}

func TestWriteFileDurablyLeavesNoTemporaryFileWhenAStepFails(t *testing.T) {
	failure := errors.New("injected failure")
	for _, tc := range []struct {
		name   string
		inject func()
	}{
		{"the write", func() {
			durableOpenFile = func(name string, flag int, mode os.FileMode) (*os.File, error) {
				// A file opened only for reading refuses the write.
				return os.OpenFile(name, os.O_CREATE|os.O_RDONLY, mode)
			}
		}},
		{"the sync", func() {
			durableSyncFile = func(*os.File) error { return failure }
		}},
		{"the rename", func() {
			durableRenameFile = func(string, string) error { return failure }
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			originalOpenFile, originalSyncFile, originalRenameFile := durableOpenFile, durableSyncFile, durableRenameFile
			t.Cleanup(func() {
				durableOpenFile, durableSyncFile, durableRenameFile = originalOpenFile, originalSyncFile, originalRenameFile
			})
			directoryPath := t.TempDir()
			filePath := filepath.Join(directoryPath, "devhost.toml")
			if err := os.WriteFile(filePath, []byte("name = \"before\"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			tc.inject()

			if err := writeFileDurably(filePath, []byte("name = \"after\"\n"), 0o600); err == nil {
				t.Fatal("writeFileDurably(...) error = nil, want the injected failure")
			}
			entries, err := os.ReadDir(directoryPath)
			if err != nil {
				t.Fatal(err)
			}
			names := make([]string, 0, len(entries))
			for _, entry := range entries {
				names = append(names, entry.Name())
			}
			if !slices.Equal(names, []string{"devhost.toml"}) {
				t.Fatalf("directory holds %v, want only devhost.toml", names)
			}
			if content, err := os.ReadFile(filePath); err != nil || string(content) != "name = \"before\"\n" {
				t.Fatalf("devhost.toml holds %q, %v; want the content from before the failed write", content, err)
			}
		})
	}
}
