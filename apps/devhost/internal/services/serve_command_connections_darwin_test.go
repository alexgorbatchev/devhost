package services

import (
	"context"
	"net"
	"os"
	"slices"
	"syscall"
	"testing"

	processnet "github.com/shirou/gopsutil/v4/net"
)

func TestCommandConnectionsParseIPv4IPv6AndWildcard(t *testing.T) {
	connections := parseCommandConnections("p123\nf4\ntIPv4\nn*:1234\nf5\ntIPv6\nn[::1]:4567\nf6\ntIPv4\nn127.0.0.1:bad\nf7\ntIPv4\nn127.0.0.1:65536\nf8\ntIPv4\nn127.0.0.1:0\nf9\nn127.0.0.1:8888\n")
	if len(connections) != 2 || connections[0].Laddr.IP != "*" || connections[0].Laddr.Port != 1234 || connections[0].Family != syscall.AF_INET || connections[1].Laddr.IP != "::1" || connections[1].Laddr.Port != 4567 || connections[1].Family != syscall.AF_INET6 {
		t.Fatalf("connections: %#v", connections)
	}
}

func TestCommandConnectionsDiscoverOnlySelectedProcessListenersAndHonorCancellation(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	port := uint32(listener.Addr().(*net.TCPAddr).Port)
	connections, err := readCommandConnections(context.Background(), os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(connections, func(connection processnet.ConnectionStat) bool {
		return connection.Laddr.Port == port && connection.Laddr.IP == "127.0.0.1"
	}) {
		t.Fatalf("listener %d absent: %#v", port, connections)
	}
	other, err := readCommandConnections(context.Background(), os.Getppid())
	if err != nil {
		t.Fatal(err)
	}
	if slices.ContainsFunc(other, func(connection processnet.ConnectionStat) bool { return connection.Laddr.Port == port }) {
		t.Fatal("another process inherited this listener")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := readCommandConnections(ctx, os.Getpid()); err == nil {
		t.Fatal("canceled discovery succeeded")
	}
}
