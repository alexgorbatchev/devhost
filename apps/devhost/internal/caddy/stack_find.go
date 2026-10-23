package caddy

import (
	"fmt"
	"net/url"
	"strings"
)

// FindLiveStackOwners searches recorded stack names, manifests, and hostnames.
// A URL identifies a hostname; its path, port, query, and fragment are ignored.
func FindLiveStackOwners(paths Paths, query string) ([]StackOwner, error) {
	query = strings.ToLower(strings.TrimSpace(query))
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
	return readLiveStackOwners(paths, func(owner recordedOwner) bool {
		return strings.Contains(strings.ToLower(owner.host), query) ||
			strings.Contains(strings.ToLower(owner.name), query) ||
			strings.Contains(strings.ToLower(owner.ManifestPath), query)
	})
}
