package nativebrowser

import (
	"fmt"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

// ParseEndpoint accepts only an explicit loopback browser control address.
// A hostname could resolve outside the machine; a page WebSocket cannot own
// the browser-level native DevTools window commands.
func ParseEndpoint(text string) (*url.URL, error) {
	u, err := url.Parse(text)
	if err != nil {
		return nil, fmt.Errorf("parse browser endpoint: %w", err)
	}
	addr, err := netip.ParseAddr(u.Hostname())
	port, portErr := strconv.Atoi(u.Port())
	if err != nil || !addr.IsLoopback() || addr.Zone() != "" || portErr != nil || port < 1 || port > 65535 {
		return nil, fmt.Errorf("browser endpoint must use a literal loopback address and a port from 1 to 65535")
	}
	if u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" || u.Opaque != "" || strings.Contains(text, "#") {
		return nil, fmt.Errorf("browser endpoint cannot contain credentials, queries, or fragments")
	}
	switch u.Scheme {
	case "http":
		if u.Path != "" && u.Path != "/" {
			return nil, fmt.Errorf("HTTP browser endpoint must use the root path")
		}
	case "ws":
		id, ok := strings.CutPrefix(u.Path, "/devtools/browser/")
		if !ok || id == "" || strings.ContainsAny(id, "/\\") || u.RawPath != "" {
			return nil, fmt.Errorf("WebSocket endpoint must identify a browser under /devtools/browser/")
		}
	default:
		return nil, fmt.Errorf("browser endpoint must use http or ws")
	}
	return u, nil
}
