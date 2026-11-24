package services

import (
	"context"
	"errors"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"syscall"

	processnet "github.com/shirou/gopsutil/v4/net"
)

func readCommandConnections(ctx context.Context, pid int) ([]processnet.ConnectionStat, error) {
	// -a intersects the PID and listener filters; lsof otherwise unions them.
	result, err := exec.CommandContext(ctx, "lsof", "-nP", "-a", "-p", strconv.Itoa(pid), "-iTCP", "-sTCP:LISTEN", "-Ftn").Output()
	if err != nil {
		var exit *exec.ExitError
		if ctx.Err() == nil && errors.As(err, &exit) && exit.ExitCode() == 1 && len(exit.Stderr) == 0 && len(result) == 0 {
			return nil, nil // No matching listeners is lsof status 1.
		}
		return nil, err
	}
	return parseCommandConnections(string(result)), nil
}

func parseCommandConnections(output string) []processnet.ConnectionStat {
	var result []processnet.ConnectionStat
	var family uint32
	for line := range strings.SplitSeq(output, "\n") {
		switch {
		case strings.HasPrefix(line, "f"), strings.HasPrefix(line, "p"):
			family = 0
		case line == "tIPv4":
			family = syscall.AF_INET
		case line == "tIPv6":
			family = syscall.AF_INET6
		case strings.HasPrefix(line, "n") && family != 0:
			host, portText, err := net.SplitHostPort(line[1:])
			if err != nil {
				continue
			}
			port, err := strconv.ParseUint(portText, 10, 16)
			if err != nil || port == 0 {
				continue
			}
			result = append(result, processnet.ConnectionStat{Family: family, Status: "LISTEN", Laddr: processnet.Addr{IP: host, Port: uint32(port)}})
		}
	}
	return result
}
