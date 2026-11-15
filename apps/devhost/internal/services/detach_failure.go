package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

// serviceNotReadyError is a service that kept a detached start from becoming
// ready. The supervisor wraps its own error, so its log reads as before; the
// caller builds one from the supervisor's failure record.
type serviceNotReadyError struct {
	service string
	err     error
}

func (e *serviceNotReadyError) Error() string {
	return e.err.Error()
}

func (e *serviceNotReadyError) Unwrap() error {
	return e.err
}

// detachedFailureRecord is what a detached supervisor leaves beside its log
// when a service keeps it from becoming ready. Its exit code alone cannot name
// the service, and its stack record is gone once its cleanup finishes.
type detachedFailureRecord struct {
	Service string `json:"service"`
}

func detachedFailurePath(logPath string) string {
	return strings.TrimSuffix(logPath, ".log") + ".failure.json"
}

// recordDetachedFailure writes the record before the supervisor's cleanup, so
// a caller that stops waiting for that cleanup can still name the service. The
// rename keeps the caller from reading a partial record.
func recordDetachedFailure(logPath, service string) error {
	data, err := json.Marshal(detachedFailureRecord{Service: service})
	if err != nil {
		return err
	}
	path := detachedFailurePath(logPath)
	file, err := os.CreateTemp(filepath.Dir(path), ".failure-*")
	if err != nil {
		return fmt.Errorf("record the detached startup failure: %w", err)
	}
	defer os.Remove(file.Name()) // Fails harmlessly once the rename has moved it.
	if _, err := file.Write(data); err != nil {
		_ = file.Close() // The write error is the one reported.
		return fmt.Errorf("record the detached startup failure: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("record the detached startup failure: %w", err)
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return fmt.Errorf("record the detached startup failure: %w", err)
	}
	return nil
}

// readDetachedFailure returns the service the supervisor recorded, or nil. A
// record that cannot be read leaves the caller with the supervisor's exit code,
// which the failure still reports.
func readDetachedFailure(path string) *serviceNotReadyError {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var record detachedFailureRecord
	if err := json.Unmarshal(data, &record); err != nil || record.Service == "" {
		return nil
	}
	return &serviceNotReadyError{
		service: record.Service,
		err:     fmt.Errorf("service %s did not become ready", record.Service),
	}
}

// removeDetachedFailure discards a record. The caller holds the start lock of
// the manifest, so no other caller reads or writes this record meanwhile.
func removeDetachedFailure(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove the previous detached startup failure: %w", err)
	}
	return nil
}

// detachedFailure is the line a failed detached start ends with: its cause and
// where the full log is. An agent reads both in the error; a person reads the
// cause and a hint.
func detachedFailure(cause error, logPath string, hint string) error {
	read := "Read the full log in " + logPath + "."
	if hint != "" {
		read += " " + hint
	}
	return &cliout.Failure{
		Err:     fmt.Errorf("%w; full log: %s", cause, logPath),
		Summary: cause.Error(),
		Hint:    read,
	}
}
