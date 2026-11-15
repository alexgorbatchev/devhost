package caddy

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// FindLiveStackOwners searches recorded stack names, manifests, and hostnames.
// A URL identifies a hostname; its path, port, query, and fragment are ignored.
// A query that names a manifest file, relative to directory when it is not
// absolute, also matches the stack of that file however its path was spelled.
func FindLiveStackOwners(paths Paths, query, directory string) ([]StackOwner, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("stack query must not be empty")
	}
	if strings.Contains(query, "://") {
		u, err := url.Parse(query)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
			return nil, fmt.Errorf("stack query must be an HTTP(S) URL, hostname, or name")
		}
		return readLiveStackOwners(paths, func(owner recordedOwner) bool {
			return strings.EqualFold(owner.host, u.Hostname())
		})
	}
	manifest := namedManifest(query, directory)
	lower := strings.ToLower(query)
	return readLiveStackOwners(paths, func(owner recordedOwner) bool {
		return strings.Contains(strings.ToLower(owner.host), lower) ||
			strings.Contains(strings.ToLower(owner.name), lower) ||
			strings.Contains(strings.ToLower(owner.ManifestPath), lower) ||
			(manifest != "" && ManifestIdentity(owner.ManifestPath) == manifest)
	})
}

// namedManifest returns the identity of the file query names, or "" when it
// names no file.
func namedManifest(query, directory string) string {
	path := query
	if !filepath.IsAbs(path) {
		path = filepath.Join(directory, path)
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return ""
	}
	return ManifestIdentity(path)
}
