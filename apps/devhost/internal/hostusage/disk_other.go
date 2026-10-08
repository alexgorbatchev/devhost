//go:build !linux

package hostusage

import (
	"context"
	"fmt"

	"github.com/shirou/gopsutil/v4/disk"
)

const rootMountpoint = "/"

// readDisk reports the volume the system is installed on. On macOS every APFS volume of the startup disk shares
// one container, so the root volume's totals describe the whole internal disk; other disks are not counted.
func readDisk(ctx context.Context) (SpaceUsage, error) {
	usage, err := disk.UsageWithContext(ctx, rootMountpoint)
	if err != nil {
		return SpaceUsage{}, fmt.Errorf("reading filesystem at %s: %w", rootMountpoint, err)
	}

	return SpaceUsage{Percent: usage.UsedPercent, UsedBytes: usage.Used, TotalBytes: usage.Total}, nil
}
