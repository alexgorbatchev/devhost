// Package hostusage samples how much of the machine's CPU, memory, and disk space is in use.
package hostusage

import (
	"context"
	"sync"
	"time"
)

// Usage is the latest reading of each readout. A nil field is a readout that is off, has no reading yet, or whose
// last read failed.
type Usage struct {
	CPU    *CPUUsage   `json:"cpu,omitempty"`
	Memory *SpaceUsage `json:"memory,omitempty"`
	Disk   *SpaceUsage `json:"disk,omitempty"`
}

type CPUUsage struct {
	// Percent is the share of all logical CPUs that was busy since the previous reading.
	Percent float64 `json:"percent"`
	Cores   int     `json:"cores"`
}

type SpaceUsage struct {
	Percent    float64 `json:"percent"`
	UsedBytes  uint64  `json:"usedBytes"`
	TotalBytes uint64  `json:"totalBytes"`
}

// Intervals sets how often each readout is read. A readout with a zero interval is off.
type Intervals struct {
	CPU    time.Duration
	Memory time.Duration
	Disk   time.Duration
}

type Readers struct {
	CPU    func(context.Context) (CPUUsage, error)
	Memory func(context.Context) (SpaceUsage, error)
	Disk   func(context.Context) (SpaceUsage, error)
}

type Options struct {
	Intervals Intervals
	Readers   Readers
	// OnChange is called after every read, with the new usage already in place.
	OnChange func()
	// OnFailure is called when a readout's reads start failing, once per outage.
	OnFailure func(readout string, err error)
}

type Sampler struct {
	onChange  func()
	onFailure func(readout string, err error)

	mu    sync.Mutex
	usage Usage
	wg    sync.WaitGroup
}

// Start reads every readout that has an interval once, then again at that interval until ctx is done.
func Start(ctx context.Context, options Options) *Sampler {
	sampler := &Sampler{onChange: options.OnChange, onFailure: options.OnFailure}

	startReadout(ctx, sampler, "cpu", options.Intervals.CPU, options.Readers.CPU, func(usage *Usage, reading *CPUUsage) {
		usage.CPU = reading
	})
	startReadout(ctx, sampler, "memory", options.Intervals.Memory, options.Readers.Memory, func(usage *Usage, reading *SpaceUsage) {
		usage.Memory = reading
	})
	startReadout(ctx, sampler, "disk", options.Intervals.Disk, options.Readers.Disk, func(usage *Usage, reading *SpaceUsage) {
		usage.Disk = reading
	})

	return sampler
}

// Usage returns the latest readings. The readings it points to are never changed afterwards.
func (s *Sampler) Usage() Usage {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usage
}

// Wait returns once every readout has stopped, which follows the cancellation of the context given to Start.
func (s *Sampler) Wait() {
	s.wg.Wait()
}

func startReadout[T any](
	ctx context.Context,
	sampler *Sampler,
	name string,
	interval time.Duration,
	read func(context.Context) (T, error),
	store func(*Usage, *T),
) {
	if interval <= 0 || read == nil {
		return
	}

	sampler.wg.Go(func() {
		isFailing := false
		readOnce := func() {
			reading, err := read(ctx)
			if ctx.Err() != nil {
				return
			}

			var stored *T
			if err == nil {
				stored = &reading
			}
			sampler.mu.Lock()
			store(&sampler.usage, stored)
			sampler.mu.Unlock()

			if err != nil && !isFailing && sampler.onFailure != nil {
				sampler.onFailure(name, err)
			}
			isFailing = err != nil
			if sampler.onChange != nil {
				sampler.onChange()
			}
		}

		readOnce()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				readOnce()
			}
		}
	})
}
