package caddy

import (
	"cmp"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"syscall"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

// StackOwner is a devhost process and the manifest whose stack it runs.
type StackOwner struct {
	ManifestPath string
	PID          int
}

// ReadLiveStackOwners returns the devhost processes that are running a stack.
// Every stack keeps a record of itself; the hostname claims, fixed port claims,
// and route registrations are read as well, because a stack started by a
// devhost that predates stack records is known only by those. Each owner is
// returned once, in manifest path and then PID order. Records left by a process
// that has exited are skipped, as are registrations that predate manifests and
// name none.
func ReadLiveStackOwners(paths Paths) ([]StackOwner, error) {
	sources := []struct {
		directoryPath string
		parse         func(recordText []byte) (recordedOwner, error)
	}{
		{directoryPath: paths.StacksDirectoryPath, parse: parseStackRecordOwner},
		{directoryPath: paths.HostClaimsDirectoryPath, parse: parseHostClaimOwner},
		{directoryPath: paths.PortClaimsDirectoryPath, parse: parseFixedPortClaimOwner},
		{directoryPath: paths.RegistrationsDirectoryPath, parse: parseRouteRegistrationOwner},
	}

	owners := []StackOwner{}
	for _, source := range sources {
		recorded, err := readRecordedOwners(source.directoryPath, source.parse)
		if err != nil {
			return nil, err
		}

		for _, owner := range recorded {
			if owner.ManifestPath == "" || owner.PID <= 0 || !routeMutationIsOwnerAlive(owner.PID, owner.startIdentity) {
				continue
			}

			owners = append(owners, owner.StackOwner)
		}
	}

	slices.SortFunc(owners, func(left StackOwner, right StackOwner) int {
		return cmp.Or(cmp.Compare(left.ManifestPath, right.ManifestPath), cmp.Compare(left.PID, right.PID))
	})

	return slices.Compact(owners), nil
}

// recordedOwner is the owner a record names, with the start identity that tells
// it from a later process with the same PID.
type recordedOwner struct {
	StackOwner
	startIdentity string
}

// readRecordedOwners reads the owner of every record in directoryPath. A
// directory that does not exist yet holds no records.
func readRecordedOwners(directoryPath string, parse func(recordText []byte) (recordedOwner, error)) ([]recordedOwner, error) {
	entries, err := os.ReadDir(directoryPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}

		return nil, fmt.Errorf("read record directory %s: %w", directoryPath, err)
	}

	owners := []recordedOwner{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}

		recordPath := filepath.Join(directoryPath, entry.Name())
		recordText, err := os.ReadFile(recordPath)
		if err != nil {
			// A stack that stops while the directory is read removes its records.
			if errors.Is(err, os.ErrNotExist) {
				continue
			}

			return nil, fmt.Errorf("read record %s: %w", recordPath, err)
		}

		owner, err := parse(recordText)
		if err != nil {
			return nil, fmt.Errorf("read record %s: %w", recordPath, err)
		}

		owners = append(owners, owner)
	}

	return owners, nil
}

func parseHostClaimOwner(recordText []byte) (recordedOwner, error) {
	claim, err := parseHostClaim(recordText)
	if err != nil {
		return recordedOwner{}, err
	}

	return recordedOwner{StackOwner: StackOwner{ManifestPath: claim.ManifestPath, PID: claim.OwnerPID}, startIdentity: claim.OwnerStartIdentity}, nil
}

func parseFixedPortClaimOwner(recordText []byte) (recordedOwner, error) {
	claim, err := parseFixedPortClaim(recordText)
	if err != nil {
		return recordedOwner{}, err
	}

	return recordedOwner{StackOwner: StackOwner{ManifestPath: claim.ManifestPath, PID: claim.OwnerPID}, startIdentity: claim.OwnerStartIdentity}, nil
}

func parseRouteRegistrationOwner(recordText []byte) (recordedOwner, error) {
	record, err := parseManagedRouteRecord(recordText)
	if err != nil {
		return recordedOwner{}, err
	}

	return recordedOwner{StackOwner: StackOwner{ManifestPath: record.ManifestPath, PID: record.OwnerPID}, startIdentity: record.OwnerStartIdentity}, nil
}

// readOwnStartIdentity returns the start identity this process writes into its
// records. On a platform that has none it returns "", and the records are
// checked by PID alone.
func readOwnStartIdentity() string {
	identity, err := procid.StartIdentity(os.Getpid())
	if err != nil {
		return ""
	}

	return identity
}

// isRecordOwnerAlive reports whether the process that wrote a record is still
// running. A PID is handed to a new process once its owner has exited, so a
// running process with the recorded PID is the owner only when it also has the
// recorded start identity. A record without one was written by a devhost that
// predates start identities, or on a platform that has none, and is checked by
// PID alone.
func isRecordOwnerAlive(processID int, startIdentity string) bool {
	if !isManagedProcessAlive(processID) {
		return false
	}
	if startIdentity == "" {
		return true
	}

	currentIdentity, err := procid.StartIdentity(processID)
	if err != nil {
		// A process that exited after the probe above is gone. Any other failure
		// leaves the owner unverified, and it keeps the benefit of the doubt: taking
		// a running stack for a dead one would hand its hostnames to another.
		return !errors.Is(err, fs.ErrNotExist) && !errors.Is(err, syscall.ESRCH)
	}

	return currentIdentity == startIdentity
}
