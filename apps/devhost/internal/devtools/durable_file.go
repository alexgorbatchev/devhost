package devtools

import (
	"fmt"
	"os"
	"path/filepath"
)

// The file operations of durable writes, replaced by tests that make one of them fail.
var (
	durableOpenFile      = os.OpenFile
	durableRenameFile    = os.Rename
	durableRemoveFile    = os.Remove
	durableSyncFile      = func(file *os.File) error { return file.Sync() }
	durableSyncDirectory = syncDirectory
)

// writeFileDurably replaces the file at filePath with payload so that a crash leaves either the old file or the new
// one: it writes a temporary file beside it, syncs it, renames it over the file, and syncs the directory. A failure
// before the rename removes the temporary file, so none is left beside the file.
func writeFileDurably(filePath string, payload []byte, mode os.FileMode) (returnedError error) {
	directoryPath := filepath.Dir(filePath)
	if err := os.MkdirAll(directoryPath, 0o700); err != nil {
		return err
	}
	id, err := createRandomID()
	if err != nil {
		return fmt.Errorf("name the temporary file for %s: %w", filePath, err)
	}
	temporaryPath := filePath + "." + id + ".tmp"
	file, err := durableOpenFile(temporaryPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	isRenamed := false
	defer func() {
		if !isRenamed {
			// The write already failed; a failed removal of its temporary file adds nothing to report.
			_ = durableRemoveFile(temporaryPath)
		}
	}()
	if _, err := file.Write(payload); err != nil {
		_ = file.Close() // The write error is the one to report.
		return err
	}
	if err := durableSyncFile(file); err != nil {
		_ = file.Close() // The sync error is the one to report.
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := durableRenameFile(temporaryPath, filePath); err != nil {
		return err
	}
	isRenamed = true
	return durableSyncDirectory(directoryPath)
}

// removeFileDurably removes the file at filePath and syncs its directory, so the removal survives a crash.
func removeFileDurably(filePath string) error {
	if err := durableRemoveFile(filePath); err != nil {
		return err
	}
	return durableSyncDirectory(filepath.Dir(filePath))
}

func syncDirectory(directoryPath string) error {
	directory, err := os.Open(directoryPath)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
