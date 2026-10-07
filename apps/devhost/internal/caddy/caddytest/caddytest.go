// Package caddytest stands in for a managed Caddy's admin endpoint in tests.
package caddytest

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nettest"
)

// StartAdminServer starts an admin endpoint that accepts every request, as a running Caddy accepts the requests
// devhost sends it, and returns its address. The endpoint stops when the test ends.
func StartAdminServer(t testing.TB) string {
	t.Helper()

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte("{}"))
	}))
	t.Cleanup(server.Close)
	return server.Listener.Addr().String()
}

// UnusedAdminAddress returns an admin address that refuses connections for the whole test, as a Caddy that is not
// running does.
func UnusedAdminAddress(t testing.TB) string {
	t.Helper()
	return net.JoinHostPort("127.0.0.1", strconv.Itoa(nettest.ReservePort(t)))
}
