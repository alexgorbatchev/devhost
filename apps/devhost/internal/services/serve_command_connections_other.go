//go:build !darwin

package services

import (
	"context"

	processnet "github.com/shirou/gopsutil/v4/net"
)

func readCommandConnections(ctx context.Context, pid int) ([]processnet.ConnectionStat, error) {
	return processnet.ConnectionsPidWithoutUidsWithContext(ctx, "tcp", int32(pid))
}
