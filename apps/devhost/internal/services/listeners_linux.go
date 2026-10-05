//go:build linux

package services

import (
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

const linuxListenState = "0A"

type linuxListeningSocket struct {
	inode   string
	localIP net.IP
	port    int
}

func readListeningProcessIDsForBindHost(bindHost string, port int) []int {
	targetIP := parseListenerBindHost(bindHost)
	if targetIP == nil || port <= 0 {
		return nil
	}

	inodes, err := readLinuxListeningSocketInodes(targetIP, port)
	if err != nil || len(inodes) == 0 {
		return nil
	}

	return readLinuxListeningProcessIDsByInode(inodes)
}

func parseListenerBindHost(bindHost string) net.IP {
	ip := net.ParseIP(strings.TrimSpace(bindHost))
	if ip == nil {
		return nil
	}

	if ipv4 := ip.To4(); ipv4 != nil {
		return ipv4
	}

	return ip.To16()
}

func readLinuxListeningSocketInodes(targetIP net.IP, port int) (map[string]struct{}, error) {
	paths := []string{"/proc/net/tcp", "/proc/net/tcp6"}
	inodes := map[string]struct{}{}
	for _, path := range paths {
		sockets, err := readLinuxListeningSockets(path)
		if err != nil {
			return nil, err
		}

		for _, socket := range sockets {
			if socket.port != port || !socket.localIP.Equal(targetIP) {
				continue
			}

			inodes[socket.inode] = struct{}{}
		}
	}

	return inodes, nil
}

func readLinuxListeningSockets(path string) ([]linuxListeningSocket, error) {
	text, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}

	sockets := []linuxListeningSocket{}
	for index, line := range strings.Split(strings.TrimSpace(string(text)), "\n") {
		if index == 0 || strings.TrimSpace(line) == "" {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 10 || fields[3] != linuxListenState {
			continue
		}

		localIP, port, err := parseLinuxSocketAddress(fields[1])
		if err != nil {
			continue
		}

		sockets = append(sockets, linuxListeningSocket{
			inode:   fields[9],
			localIP: localIP,
			port:    port,
		})
	}

	return sockets, nil
}

func parseLinuxSocketAddress(value string) (net.IP, int, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return nil, 0, fmt.Errorf("parse linux socket address %q", value)
	}

	ip, err := parseLinuxSocketHexIP(parts[0])
	if err != nil {
		return nil, 0, err
	}

	portValue, err := strconv.ParseInt(parts[1], 16, 32)
	if err != nil {
		return nil, 0, fmt.Errorf("parse linux socket port %q: %w", value, err)
	}

	return ip, int(portValue), nil
}

func parseLinuxSocketHexIP(value string) (net.IP, error) {
	bytes, err := hex.DecodeString(value)
	if err != nil {
		return nil, fmt.Errorf("decode linux socket IP %q: %w", value, err)
	}

	switch len(bytes) {
	case net.IPv4len:
		return net.IP{bytes[3], bytes[2], bytes[1], bytes[0]}, nil
	case net.IPv6len:
		decoded := make(net.IP, net.IPv6len)
		for index := 0; index < net.IPv6len; index += 4 {
			decoded[index] = bytes[index+3]
			decoded[index+1] = bytes[index+2]
			decoded[index+2] = bytes[index+1]
			decoded[index+3] = bytes[index]
		}
		return decoded, nil
	default:
		return nil, fmt.Errorf("unexpected linux socket IP length %d", len(bytes))
	}
}

func readLinuxListeningProcessIDsByInode(targetInodes map[string]struct{}) []int {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}

	seen := map[int]struct{}{}
	pids := []int{}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		fdEntries, err := os.ReadDir(filepath.Join("/proc", entry.Name(), "fd"))
		if err != nil {
			continue
		}

		matched := false
		for _, fdEntry := range fdEntries {
			target, err := os.Readlink(filepath.Join("/proc", entry.Name(), "fd", fdEntry.Name()))
			if err != nil {
				continue
			}

			inode, ok := parseLinuxSocketInode(target)
			if !ok {
				continue
			}
			if _, ok := targetInodes[inode]; !ok {
				continue
			}

			matched = true
			break
		}

		if !matched {
			continue
		}
		if _, ok := seen[pid]; ok {
			continue
		}

		seen[pid] = struct{}{}
		pids = append(pids, pid)
	}

	sort.Ints(pids)
	return pids
}

func parseLinuxSocketInode(value string) (string, bool) {
	if !strings.HasPrefix(value, "socket:[") || !strings.HasSuffix(value, "]") {
		return "", false
	}

	return strings.TrimSuffix(strings.TrimPrefix(value, "socket:["), "]"), true
}
