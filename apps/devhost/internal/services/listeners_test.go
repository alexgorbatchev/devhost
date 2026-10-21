package services

import (
	"net"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"testing"
)

func TestReadListeningProcessIDsFindsTheProcessListeningOnAPort(t *testing.T) {
	if runtime.GOOS != "linux" {
		if _, err := exec.LookPath("lsof"); err != nil {
			t.Skip("listeners are read through lsof outside Linux, and lsof is not installed")
		}
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	if pids := readListeningProcessIDsForBindHost("127.0.0.1", port); !slices.Contains(pids, os.Getpid()) {
		t.Fatalf("readListeningProcessIDsForBindHost(127.0.0.1, %d) = %v, want this process %d", port, pids, os.Getpid())
	}
}
