package hostusage

import (
	"testing"
)

// The readers are exercised against the machine running the tests: whatever it is, it has CPUs, memory, and a
// system disk with something on it.
func TestHostReadersReadThisMachine(t *testing.T) {
	t.Parallel()

	readers := HostReaders()

	cpuUsage, err := readers.CPU(t.Context())
	if err != nil {
		t.Fatalf("CPU reader error = %v", err)
	}
	if cpuUsage.Cores < 1 || cpuUsage.Percent < 0 || cpuUsage.Percent > 100 {
		t.Fatalf("CPU usage = %+v, want at least one core and a percentage", cpuUsage)
	}

	spaceReaders := []struct {
		name string
		read func() (SpaceUsage, error)
	}{
		{"memory", func() (SpaceUsage, error) { return readers.Memory(t.Context()) }},
		{"disk", func() (SpaceUsage, error) { return readers.Disk(t.Context()) }},
	}
	for _, reader := range spaceReaders {
		usage, err := reader.read()
		if err != nil {
			t.Fatalf("%s reader error = %v", reader.name, err)
		}
		if usage.UsedBytes == 0 || usage.UsedBytes > usage.TotalBytes || usage.Percent <= 0 || usage.Percent > 100 {
			t.Fatalf("%s usage = %+v, want used space within the total and a matching percentage", reader.name, usage)
		}
		t.Logf("%s: %.1f%% (%d of %d bytes)", reader.name, usage.Percent, usage.UsedBytes, usage.TotalBytes)
	}
}
