package hostusage

import (
	"context"
	"fmt"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/mem"
)

// HostReaders reads the machine devhost runs on.
func HostReaders() Readers {
	return Readers{CPU: readCPU, Memory: readMemory, Disk: readDisk}
}

func readCPU(ctx context.Context) (CPUUsage, error) {
	// A zero interval compares the CPU times with those of the previous call instead of blocking for a sample.
	percents, err := cpu.PercentWithContext(ctx, 0, false)
	if err != nil {
		return CPUUsage{}, fmt.Errorf("reading CPU times: %w", err)
	}
	if len(percents) != 1 {
		return CPUUsage{}, fmt.Errorf("reading CPU times: got %d combined values, want 1", len(percents))
	}
	cores, err := cpu.CountsWithContext(ctx, true)
	if err != nil {
		return CPUUsage{}, fmt.Errorf("counting logical CPUs: %w", err)
	}

	return CPUUsage{Percent: percents[0], Cores: cores}, nil
}

func readMemory(ctx context.Context) (SpaceUsage, error) {
	memory, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return SpaceUsage{}, fmt.Errorf("reading memory: %w", err)
	}

	return SpaceUsage{Percent: memory.UsedPercent, UsedBytes: memory.Used, TotalBytes: memory.Total}, nil
}
