package caddy

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/procid"
)

// StackOccupant describes a live owner of a checkout's manifest inputs.
type StackOccupant struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	PID          int      `json:"pid"`
	ManifestPath string   `json:"manifestPath"`
	URLs         []string `json:"urls"`
	record       stackRecord
}

func ReadStackOccupants(paths Paths, files []string) ([]StackOccupant, error) {
	files, err := canonicalManifestFiles(files)
	if err != nil {
		return nil, err
	}
	conflicts, err := overlappingStacks(paths.StacksDirectoryPath, files, routeMutationProcessID())
	if err != nil {
		return nil, err
	}
	var result []StackOccupant
	for _, conflict := range conflicts {
		r := conflict.record
		urls, err := stackRouteURLs(paths, r)
		if err != nil {
			return nil, err
		}
		result = append(result, StackOccupant{ID: stackOccupantID(r), Name: r.StackName, PID: r.OwnerPID, ManifestPath: r.ManifestPath, URLs: urls, record: r})
	}
	return result, nil
}

func stackOccupantID(r stackRecord) string {
	// CreatedAt changes when a stack re-registers: a stale stop request must be
	// reviewed again even when the same process now owns different inputs.
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d\x00%s\x00%s\x00%s\x00%s", r.OwnerPID, r.OwnerStartIdentity, r.ManifestPath, r.CreatedAt, strings.Join(r.ManifestFiles, "\x00"))))
	return hex.EncodeToString(sum[:])
}

func (o StackOccupant) Alive() bool {
	return routeMutationIsOwnerAlive(o.PID, o.record.OwnerStartIdentity)
}

// Signal revalidates the exact recorded stack, and refuses self or reused PIDs.
func (o StackOccupant) Signal(paths Paths, signal os.Signal) error {
	return withStackRecordsLock(paths.StacksDirectoryPath, func() error {
		return o.signal(paths, signal)
	})
}

func (o StackOccupant) signal(paths Paths, signal os.Signal) error {
	if o.PID <= 0 || o.PID == os.Getpid() {
		return fmt.Errorf("cannot stop this stack")
	}
	process, err := os.FindProcess(o.PID)
	if err != nil {
		return err
	}
	defer process.Release() // Release the OS process handle; this process is not our child.
	data, err := os.ReadFile(filepath.Join(paths.StacksDirectoryPath, strconv.Itoa(o.PID)+".json"))
	if err != nil {
		return fmt.Errorf("stack ownership changed; refresh worktrees: %w", err)
	}
	r, err := parseStackRecord(data)
	if err != nil {
		return err
	}
	if stackOccupantID(r) != o.ID {
		return fmt.Errorf("stack ownership changed; refresh worktrees")
	}
	identity, err := procid.StartIdentity(o.PID)
	if err != nil {
		return err
	}
	if identity == "" || identity != r.OwnerStartIdentity {
		return fmt.Errorf("stack process identity changed; refresh worktrees")
	}
	return process.Signal(signal)
}

func stackRouteURLs(paths Paths, owner stackRecord) ([]string, error) {
	urls := []string{}
	entries, err := os.ReadDir(paths.RegistrationsDirectoryPath)
	if errors.Is(err, os.ErrNotExist) {
		return urls, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(paths.RegistrationsDirectoryPath, entry.Name()))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		r, err := parseManagedRouteRecord(data)
		if err != nil {
			return nil, err
		}
		if r.OwnerPID != owner.OwnerPID || r.OwnerStartIdentity != owner.OwnerStartIdentity {
			continue
		}
		// A route wildcard is a matcher, not a URL. Its prefix is navigable.
		path, _, _ := strings.Cut(r.Path, "*")
		if path == "" {
			path = "/"
		}
		u := url.URL{Scheme: "https", Host: r.Host, Path: path}
		urls = append(urls, u.String())
	}
	slices.Sort(urls)
	return slices.Compact(urls), nil
}
