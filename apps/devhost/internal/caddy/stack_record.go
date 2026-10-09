package caddy

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// stackRecord is what a running stack says about itself. Claims and route
// registrations exist only for the hostnames and fixed ports a stack holds;
// this record exists for every stack, so one that holds neither is known too.
type stackRecord struct {
	CreatedAt          string `json:"createdAt"`
	ManifestPath       string `json:"manifestPath"`
	OwnerPID           int    `json:"ownerPid"`
	OwnerStartIdentity string `json:"ownerStartIdentity,omitempty"`
	StackName          string `json:"stackName"`
}

type stackRecordJSON struct {
	CreatedAt          *string `json:"createdAt"`
	ManifestPath       *string `json:"manifestPath"`
	OwnerPID           *int    `json:"ownerPid"`
	OwnerStartIdentity *string `json:"ownerStartIdentity"`
	StackName          *string `json:"stackName"`
}

type RegisterStackOptions struct {
	ManifestPath        string
	StackName           string
	StacksDirectoryPath string
}

// RegisterStack records that this process runs the stack of a manifest. The
// record replaces any this process wrote before, and any left under its PID by
// a process that has exited.
func RegisterStack(options RegisterStackOptions) error {
	if err := os.MkdirAll(options.StacksDirectoryPath, 0o755); err != nil {
		return fmt.Errorf("create stack records directory %s: %w", options.StacksDirectoryPath, err)
	}

	record := stackRecord{
		CreatedAt:          formatRouteMutationTimestamp(routeMutationNow()),
		ManifestPath:       options.ManifestPath,
		OwnerPID:           routeMutationProcessID(),
		OwnerStartIdentity: routeMutationOwnerStartIdentity(),
		StackName:          options.StackName,
	}
	recordText, _ := json.MarshalIndent(record, "", "  ") // Primitive-only fields cannot fail JSON marshaling.

	// Written beside the record and renamed over it, so a reader never sees half a
	// record. The temporary name has no .json extension and is not read as one.
	temporaryFile, err := os.CreateTemp(options.StacksDirectoryPath, "stack-*.tmp")
	if err != nil {
		return fmt.Errorf("create stack record: %w", err)
	}
	temporaryPath := temporaryFile.Name()
	if _, err := temporaryFile.Write(recordText); err != nil {
		_ = temporaryFile.Close()    // best-effort close after write failure.
		_ = os.Remove(temporaryPath) // best-effort removal; the write failure is returned.
		return fmt.Errorf("write stack record: %w", err)
	}
	if err := temporaryFile.Close(); err != nil {
		_ = os.Remove(temporaryPath) // best-effort removal; the close failure is returned.
		return fmt.Errorf("write stack record: %w", err)
	}
	if err := os.Rename(temporaryPath, getStackRecordPath(options.StacksDirectoryPath)); err != nil {
		_ = os.Remove(temporaryPath) // best-effort removal; the rename failure is returned.
		return fmt.Errorf("write stack record: %w", err)
	}

	return nil
}

// UnregisterStack removes the record of this process. A process that never
// registered has none, which is not an error.
func UnregisterStack(stacksDirectoryPath string) error {
	return removeIfExists(getStackRecordPath(stacksDirectoryPath))
}

// CleanupStaleStackRecords removes the records of stacks that exited without
// unregistering.
func CleanupStaleStackRecords(stacksDirectoryPath string) error {
	entries, err := os.ReadDir(stacksDirectoryPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		recordPath := filepath.Join(stacksDirectoryPath, entry.Name())
		recordText, err := os.ReadFile(recordPath)
		if err != nil {
			// A stack that stops while the directory is read removes its record.
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return err
		}
		record, err := parseStackRecord(recordText)
		if err != nil {
			return fmt.Errorf("read stack record %s: %w", recordPath, err)
		}
		if record.OwnerPID == routeMutationProcessID() || routeMutationIsOwnerAlive(record.OwnerPID, record.OwnerStartIdentity) {
			continue
		}

		if err := removeIfExists(recordPath); err != nil {
			return err
		}
	}

	return nil
}

func parseStackRecord(recordText []byte) (stackRecord, error) {
	var value stackRecordJSON
	if err := json.Unmarshal(recordText, &value); err != nil {
		return stackRecord{}, err
	}
	if value.CreatedAt == nil || value.ManifestPath == nil || value.OwnerPID == nil || value.StackName == nil {
		return stackRecord{}, fmt.Errorf("Stack record is malformed.")
	}

	record := stackRecord{CreatedAt: *value.CreatedAt, ManifestPath: *value.ManifestPath, OwnerPID: *value.OwnerPID, StackName: *value.StackName}
	if value.OwnerStartIdentity != nil {
		record.OwnerStartIdentity = *value.OwnerStartIdentity
	}

	return record, nil
}

func parseStackRecordOwner(recordText []byte) (recordedOwner, error) {
	record, err := parseStackRecord(recordText)
	if err != nil {
		return recordedOwner{}, err
	}

	return recordedOwner{StackOwner: StackOwner{ManifestPath: record.ManifestPath, PID: record.OwnerPID}, startIdentity: record.OwnerStartIdentity}, nil
}

// getStackRecordPath returns where this process keeps its record. A process
// runs one stack, so its PID names the record.
func getStackRecordPath(stacksDirectoryPath string) string {
	return filepath.Join(stacksDirectoryPath, strconv.Itoa(routeMutationProcessID())+".json")
}
