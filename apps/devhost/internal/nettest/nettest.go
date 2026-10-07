// Package nettest hands out loopback TCP ports to tests that run next to other tests and other test processes.
package nettest

import (
	"testing"

	"github.com/hashicorp/consul/sdk/freeport"
)

// ReservePorts returns n loopback TCP ports that nothing listens on. They come from a block outside the range the
// kernel assigns to ":0" listeners and stay with the test until it ends, so the test can hand them to devhost or to
// a child process, or use one as an address that refuses connections.
//
// It calls freeport.Take instead of freeport.GetN, which writes two lines to stderr for every reservation.
func ReservePorts(t testing.TB, n int) []int {
	t.Helper()

	ports, err := freeport.Take(n)
	if err != nil {
		t.Fatalf("freeport.Take(%d) error = %v", n, err)
	}
	t.Cleanup(func() { freeport.Return(ports) })
	return ports
}

// ReservePort returns one port reserved as ReservePorts reserves them.
func ReservePort(t testing.TB) int {
	t.Helper()
	return ReservePorts(t, 1)[0]
}
