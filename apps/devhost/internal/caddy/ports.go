package caddy

import (
	"net"
	"net/url"
	"strconv"
)

const (
	defaultManagedCaddyHTTPPort  = 80
	defaultManagedCaddyHTTPSPort = 443
)

func FormatManagedCaddySiteAddress(protocol string, port int, host string) string {
	defaultPort := readDefaultManagedCaddyPort(protocol)
	if port == defaultPort {
		return protocol + "://" + host
	}

	return protocol + "://" + host + ":" + strconv.Itoa(port)
}

func CreateManagedCaddyURL(protocol string, host string, port int, path string) string {
	routeURL := &url.URL{Path: path, Scheme: protocol}
	if port == readDefaultManagedCaddyPort(protocol) {
		routeURL.Host = host
	} else {
		routeURL.Host = net.JoinHostPort(host, strconv.Itoa(port))
	}

	return routeURL.String()
}

func readDefaultManagedCaddyPort(protocol string) int {
	if protocol == "http" {
		return defaultManagedCaddyHTTPPort
	}

	return defaultManagedCaddyHTTPSPort
}
