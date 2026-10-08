package hostusage

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/shirou/gopsutil/v4/disk"
)

// writeBlockDevice adds one block device to a sysfs tree the way the kernel lays it out: the device directory under
// devices/, reached through a class/block/<name> symbolic link.
func writeBlockDevice(t *testing.T, sysfsPath string, devicePath string, files map[string]string) {
	t.Helper()

	directoryPath := filepath.Join(sysfsPath, "devices", devicePath)
	if err := os.MkdirAll(directoryPath, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(directoryPath, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	classPath := filepath.Join(sysfsPath, "class", "block")
	if err := os.MkdirAll(classPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(directoryPath, filepath.Join(classPath, filepath.Base(devicePath))); err != nil {
		t.Fatal(err)
	}
}

func TestIsRemovableBlockDevice(t *testing.T) {
	t.Parallel()

	sysfsPath := t.TempDir()
	const internalDisk = "pci0000:00/0000:00:1d.0/nvme/nvme0/nvme0n1"
	const usbDisk = "pci0000:00/0000:00:14.0/usb2/2-1/2-1:1.0/host4/target4:0:0/4:0:0:0/block/sda"
	const cardReader = "pci0000:00/0000:00:1c.0/mmc_host/mmc0/mmc0:0001/block/mmcblk0"
	writeBlockDevice(t, sysfsPath, internalDisk, map[string]string{"removable": "0\n"})
	writeBlockDevice(t, sysfsPath, internalDisk+"/nvme0n1p2", map[string]string{"partition": "2\n"})
	// A USB hard disk reports itself as not removable; only its place on the USB bus tells it apart.
	writeBlockDevice(t, sysfsPath, usbDisk, map[string]string{"removable": "0\n"})
	writeBlockDevice(t, sysfsPath, usbDisk+"/sda1", map[string]string{"partition": "1\n"})
	writeBlockDevice(t, sysfsPath, cardReader, map[string]string{"removable": "1\n"})
	writeBlockDevice(t, sysfsPath, cardReader+"/mmcblk0p1", map[string]string{"partition": "1\n"})
	// Device-mapper volumes (LVM, LUKS) are virtual; what they sit on decides.
	writeBlockDevice(t, sysfsPath, "virtual/block/dm-0", nil)
	writeBlockDevice(t, sysfsPath, "virtual/block/dm-1", nil)
	for volume, slave := range map[string]string{"dm-0": "nvme0n1p2", "dm-1": "sda1"} {
		slavesPath := filepath.Join(sysfsPath, "devices", "virtual", "block", volume, "slaves")
		if err := os.MkdirAll(slavesPath, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(sysfsPath, "class", "block", slave), filepath.Join(slavesPath, slave)); err != nil {
			t.Fatal(err)
		}
	}

	tests := []struct {
		name string
		want bool
	}{
		{"nvme0n1p2", false},
		{"nvme0n1", false},
		{"sda1", true},
		{"sda", true},
		{"mmcblk0p1", true},
		{"dm-0", false},
		{"dm-1", true},
		// Nothing is known about a device sysfs does not list, such as a ZFS pool; it counts as fixed.
		{"tank", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := isRemovableBlockDevice(sysfsPath, tt.name); got != tt.want {
				t.Fatalf("isRemovableBlockDevice(%q) = %t, want %t", tt.name, got, tt.want)
			}
		})
	}
}

func TestFixedMountpoints(t *testing.T) {
	t.Parallel()

	partitions := []disk.PartitionStat{
		{Device: "/dev/nvme0n1p2", Mountpoint: "/"},
		// A second mount of a filesystem already counted, such as a Btrfs subvolume or a bind mount.
		{Device: "/dev/nvme0n1p2", Mountpoint: "/home"},
		{Device: "/dev/nvme0n1p1", Mountpoint: "/boot/efi"},
		{Device: "/dev/sda1", Mountpoint: "/media/usb"},
		// An image file mounted through a loop device lives on a filesystem that is counted itself.
		{Device: "/dev/loop3", Mountpoint: "/snap/core/1"},
		{Device: "/dev/sdb1", Mountpoint: "/data"},
	}
	isRemovable := func(name string) bool { return name == "sda1" }

	got := fixedMountpoints(partitions, isRemovable)
	if want := []string{"/", "/boot/efi", "/data"}; !slices.Equal(got, want) {
		t.Fatalf("fixedMountpoints(...) = %q, want %q", got, want)
	}
}
