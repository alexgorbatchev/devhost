// Package nettest provides loopback addresses for tests that run next to other tests and other test processes.
package nettest

import (
	"net"
	"testing"

	"golang.org/x/sys/unix"
)

// ReserveRefusingAddress binds a loopback TCP port without listening on it. Connections to it are refused, and
// unlike the port of a listener that was just closed, nothing else can start listening there while the test runs.
func ReserveRefusingAddress(t testing.TB) *net.TCPAddr {
	t.Helper()

	socket, err := unix.Socket(unix.AF_INET, unix.SOCK_STREAM, 0)
	if err != nil {
		t.Fatalf("Socket(...) error = %v", err)
	}
	t.Cleanup(func() { _ = unix.Close(socket) })
	if err := unix.Bind(socket, &unix.SockaddrInet4{Addr: [4]byte{127, 0, 0, 1}}); err != nil {
		t.Fatalf("Bind(...) error = %v", err)
	}
	address, err := unix.Getsockname(socket)
	if err != nil {
		t.Fatalf("Getsockname(...) error = %v", err)
	}
	boundAddress, ok := address.(*unix.SockaddrInet4)
	if !ok {
		t.Fatalf("bound address = %#v, want IPv4", address)
	}
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: boundAddress.Port}
}
