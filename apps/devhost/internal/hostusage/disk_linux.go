package hostusage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/shirou/gopsutil/v4/disk"
	"golang.org/x/sys/unix"
)

const (
	sysfsPath          = "/sys"
	rootMountpoint     = "/"
	loopDevicePrefix   = "loop"
	removableAttribute = "1"
)

// A block device attached through USB has a usbN bus segment in its sysfs device path.
var usbBusSegment = regexp.MustCompile(`/usb\d+/`)

// readDisk adds up the space of every fixed local filesystem, the way `df` counts it: used space against the space
// an unprivileged process can use, which leaves out the blocks a filesystem reserves for root.
func readDisk(ctx context.Context) (SpaceUsage, error) {
	partitions, err := disk.PartitionsWithContext(ctx, false)
	if err != nil {
		return SpaceUsage{}, fmt.Errorf("listing mounted filesystems: %w", err)
	}

	mountpoints := fixedMountpoints(partitions, func(name string) bool {
		return isRemovableBlockDevice(sysfsPath, name)
	})
	if len(mountpoints) == 0 {
		// The root filesystem sits on something that is not a block device, such as a ZFS pool.
		mountpoints = []string{rootMountpoint}
	}

	var usedBytes, usableBytes uint64
	for _, mountpoint := range mountpoints {
		var stat unix.Statfs_t
		if err := unix.Statfs(mountpoint, &stat); err != nil {
			return SpaceUsage{}, fmt.Errorf("reading filesystem at %s: %w", mountpoint, err)
		}
		blockSize := uint64(stat.Bsize)
		used := (stat.Blocks - stat.Bfree) * blockSize
		usedBytes += used
		usableBytes += used + stat.Bavail*blockSize
	}
	if usableBytes == 0 {
		return SpaceUsage{}, fmt.Errorf("fixed filesystems report no space")
	}

	return SpaceUsage{
		Percent:    float64(usedBytes) / float64(usableBytes) * 100,
		UsedBytes:  usedBytes,
		TotalBytes: usableBytes,
	}, nil
}

// fixedMountpoints returns one mountpoint for every filesystem on a fixed disk, in the order of partitions.
func fixedMountpoints(partitions []disk.PartitionStat, isRemovable func(name string) bool) []string {
	mountpoints := []string{}
	seenDevices := map[string]struct{}{}
	for _, partition := range partitions {
		if _, seen := seenDevices[partition.Device]; seen {
			continue
		}
		seenDevices[partition.Device] = struct{}{}

		name := blockDeviceName(partition.Device)
		if strings.HasPrefix(name, loopDevicePrefix) || isRemovable(name) {
			continue
		}
		mountpoints = append(mountpoints, partition.Mountpoint)
	}

	return mountpoints
}

// blockDeviceName returns the kernel name of a mounted device. /dev/mapper/<volume> and /dev/disk/by-*/<id> are
// symbolic links to it.
func blockDeviceName(device string) string {
	if resolved, err := filepath.EvalSymlinks(device); err == nil {
		return filepath.Base(resolved)
	}

	return filepath.Base(device)
}

// isRemovableBlockDevice reports whether the named block device, or anything it is built on, is USB-attached or
// marked removable by the kernel. A device sysfs does not describe counts as fixed.
func isRemovableBlockDevice(sysfsPath string, name string) bool {
	devicePath, err := filepath.EvalSymlinks(filepath.Join(sysfsPath, "class", "block", name))
	if err != nil {
		return false
	}

	if slaves, err := os.ReadDir(filepath.Join(devicePath, "slaves")); err == nil && len(slaves) > 0 {
		for _, slave := range slaves {
			if isRemovableBlockDevice(sysfsPath, slave.Name()) {
				return true
			}
		}
		return false
	}

	if usbBusSegment.MatchString(filepath.ToSlash(devicePath) + "/") {
		return true
	}

	// The removable attribute belongs to the whole disk, the parent directory of a partition.
	diskPath := devicePath
	if _, err := os.Stat(filepath.Join(devicePath, "partition")); err == nil {
		diskPath = filepath.Dir(devicePath)
	}
	removable, err := os.ReadFile(filepath.Join(diskPath, "removable"))

	return err == nil && strings.TrimSpace(string(removable)) == removableAttribute
}
