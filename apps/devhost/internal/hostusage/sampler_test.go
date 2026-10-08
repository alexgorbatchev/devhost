package hostusage

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"
)

type countingReaders struct {
	cpu, memory, disk atomic.Int64
}

func describe(usage Usage) string {
	encoded, err := json.Marshal(usage)
	if err != nil {
		return err.Error()
	}
	return string(encoded)
}

func (c *countingReaders) readers() Readers {
	return Readers{
		CPU: func(context.Context) (CPUUsage, error) {
			return CPUUsage{Percent: float64(c.cpu.Add(1)), Cores: 8}, nil
		},
		Memory: func(context.Context) (SpaceUsage, error) {
			return SpaceUsage{Percent: float64(c.memory.Add(1)), UsedBytes: 1, TotalBytes: 4}, nil
		},
		Disk: func(context.Context) (SpaceUsage, error) {
			return SpaceUsage{Percent: float64(c.disk.Add(1)), UsedBytes: 2, TotalBytes: 8}, nil
		},
	}
}

func TestSamplerReadsEachReadoutAtItsOwnInterval(t *testing.T) {
	t.Parallel()

	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		counts := &countingReaders{}
		var changes atomic.Int64
		sampler := Start(ctx, Options{
			Intervals: Intervals{CPU: time.Second, Memory: 2 * time.Second, Disk: 10 * time.Second},
			Readers:   counts.readers(),
			OnChange:  func() { changes.Add(1) },
		})

		// Every readout is read once at the start, so a page that connects right away has values to show.
		synctest.Wait()
		if got, want := sampler.Usage(), (Usage{
			CPU:    &CPUUsage{Percent: 1, Cores: 8},
			Memory: &SpaceUsage{Percent: 1, UsedBytes: 1, TotalBytes: 4},
			Disk:   &SpaceUsage{Percent: 1, UsedBytes: 2, TotalBytes: 8},
		}); describe(got) != describe(want) {
			t.Fatalf("first usage = %s, want %s", describe(got), describe(want))
		}

		time.Sleep(5*time.Second + time.Millisecond)
		synctest.Wait()
		if cpu, memory, disk := counts.cpu.Load(), counts.memory.Load(), counts.disk.Load(); cpu != 6 || memory != 3 || disk != 1 {
			t.Fatalf("reads after 5s = cpu %d, memory %d, disk %d; want 6, 3, 1", cpu, memory, disk)
		}
		if got := changes.Load(); got != 10 {
			t.Fatalf("change notifications after 5s = %d, want one per read (10)", got)
		}
		if got := sampler.Usage().CPU.Percent; got != 6 {
			t.Fatalf("latest CPU percent = %v, want the sixth reading", got)
		}

		cancel()
		sampler.Wait()
		time.Sleep(time.Minute)
		if got := counts.cpu.Load(); got != 6 {
			t.Fatalf("CPU reads after cancellation = %d, want 6", got)
		}
	})
}

func TestSamplerSkipsReadoutsWithoutAnInterval(t *testing.T) {
	t.Parallel()

	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		counts := &countingReaders{}
		sampler := Start(ctx, Options{Intervals: Intervals{Memory: time.Second}, Readers: counts.readers()})

		time.Sleep(3*time.Second + time.Millisecond)
		synctest.Wait()
		usage := sampler.Usage()
		if usage.CPU != nil || usage.Disk != nil || usage.Memory == nil {
			t.Fatalf("usage = %s, want memory only", describe(usage))
		}
		if cpu, disk := counts.cpu.Load(), counts.disk.Load(); cpu != 0 || disk != 0 {
			t.Fatalf("reads of readouts that are off = cpu %d, disk %d; want none", cpu, disk)
		}

		cancel()
		sampler.Wait()
	})
}

func TestSamplerDropsAReadoutWhileItsReadsFail(t *testing.T) {
	t.Parallel()

	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		readFailure := errors.New("mount table unreadable")
		var reads atomic.Int64
		var failuresMu sync.Mutex
		var failures []string
		sampler := Start(ctx, Options{
			Intervals: Intervals{Disk: time.Second},
			Readers: Readers{Disk: func(context.Context) (SpaceUsage, error) {
				// Reads two and three fail; the rest succeed.
				if read := reads.Add(1); read == 2 || read == 3 {
					return SpaceUsage{}, readFailure
				}
				return SpaceUsage{Percent: 40, UsedBytes: 4, TotalBytes: 10}, nil
			}},
			OnFailure: func(readout string, err error) {
				failuresMu.Lock()
				defer failuresMu.Unlock()
				failures = append(failures, readout+": "+err.Error())
			},
		})

		synctest.Wait()
		if sampler.Usage().Disk == nil {
			t.Fatal("disk usage is missing after a successful first read")
		}

		time.Sleep(2*time.Second + time.Millisecond)
		synctest.Wait()
		if got := sampler.Usage().Disk; got != nil {
			t.Fatalf("disk usage = %+v after failed reads, want none", *got)
		}
		// The second consecutive failure is the same outage, not news.
		failuresMu.Lock()
		defer failuresMu.Unlock()
		if len(failures) != 1 || failures[0] != "disk: mount table unreadable" {
			t.Fatalf("reported failures = %q, want the first failure once", failures)
		}

		time.Sleep(time.Second)
		synctest.Wait()
		if sampler.Usage().Disk == nil {
			t.Fatal("disk usage is missing after reads recovered")
		}

		cancel()
		sampler.Wait()
	})
}
