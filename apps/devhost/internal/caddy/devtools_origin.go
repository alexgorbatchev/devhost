package caddy

import (
	"fmt"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
)

type DevtoolsRouteOwner struct {
	ManifestPath string
	ControlPort  int
}

// AllowsDevtoolsURL reads the same registrations and shared listener settings
// used to render managed routes. Re-reading on every action also withdraws a
// document whose route moved to another stack.
func AllowsDevtoolsURL(paths Paths, owner DevtoolsRouteOwner, text string) (bool, error) {
	u, err := url.Parse(text)
	if err != nil {
		return false, nil
	}
	if u.User != nil || u.Opaque != "" || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false, nil
	}
	settings, err := ReadManagedCaddyGlobalSettings(paths, ManagedCaddyConfigFallback{})
	if err != nil {
		return false, fmt.Errorf("read native browser route settings: %w", err)
	}
	port := settings.HTTPSPort
	if u.Scheme == "http" {
		if !settings.HTTPEnabled {
			return false, nil
		}
		port = settings.HTTPPort
	}
	actualPort := u.Port()
	if actualPort == "" {
		actualPort = "443"
		if u.Scheme == "http" {
			actualPort = "80"
		}
	}
	if actualPort != strconv.Itoa(port) {
		return false, nil
	}
	registrations, err := readHostRegistrations(strings.ToLower(u.Hostname()), paths.RoutesDirectoryPath)
	if err != nil {
		return false, fmt.Errorf("read native browser host routes: %w", err)
	}
	return ownsDevtoolsDocument(registrations, owner, u.Path), nil
}

func ownsDevtoolsDocument(registrations []routeRegistration, owner DevtoolsRouteOwner, pathname string) bool {
	pathname = normalizeDevtoolsRequestPath(pathname)
	if strings.HasPrefix(pathname, "/__devhost__/") {
		return false
	}
	var root *routeRegistration
	for i := range registrations {
		r := &registrations[i]
		if r.Path == "/" {
			root = r
		}
		// Escaped matcher literals and repeated slashes have special Caddy semantics.
		// Withhold access for these host configurations rather than select a wrong
		// document using an approximation of the native matcher.
		if strings.Contains(r.Path, "%") || strings.Contains(r.Path, "//") {
			return false
		}
	}
	if root == nil || !ownsDevtoolsRegistration(*root, owner) {
		return false
	}
	// readHostRegistrations returns the same specificity order as the route
	// renderer; non-root handles precede the root catch-all.
	for _, r := range registrations {
		if r.Path == "/" {
			continue
		}
		match := strings.EqualFold(pathname, r.Path)
		if prefix, ok := strings.CutSuffix(r.Path, "*"); ok {
			match = strings.HasPrefix(strings.ToLower(pathname), strings.ToLower(prefix))
		}
		if match {
			return ownsDevtoolsRegistration(r, owner)
		}
	}
	return true
}

func ownsDevtoolsRegistration(r routeRegistration, owner DevtoolsRouteOwner) bool {
	return owner.ControlPort > 0 && r.DevtoolsControlPort != nil && *r.DevtoolsControlPort == owner.ControlPort && r.ManifestPath == owner.ManifestPath && r.OwnerPID == os.Getpid()
}

func normalizeDevtoolsRequestPath(value string) string {
	clean := path.Clean("/" + strings.TrimPrefix(value, "/"))
	if strings.HasSuffix(value, "/") && clean != "/" {
		clean += "/"
	}
	return strings.ToLower(clean)
}
