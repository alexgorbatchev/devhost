package services

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

// minProbeTimeout is the floor for the per-attempt network timeout so a
// pathologically small (or zero) Interval cannot collapse the dial / HTTP
// probe budget to zero. Matches the historical constant.
const minProbeTimeout = 200 * time.Millisecond

type WaitForServiceHealthOptions struct {
	Health       ResolvedHealthConfig
	ReadExitCode func() *int
	ServiceName  string
	OnProgress   func(attempts int, elapsed time.Duration)
}

type healthDependencies struct {
	canConnectToPort    func(context.Context, string, int, time.Duration) bool
	isReadyHTTPEndpoint func(context.Context, string, time.Duration) bool
	now                 func() time.Time
	sleep               func(context.Context, time.Duration) error
}

// probeTimeoutFor derives the per-attempt network timeout from the configured
// Interval, floored by minProbeTimeout so each probe always has a usable budget.
func probeTimeoutFor(health ResolvedHealthConfig) time.Duration {
	interval := time.Duration(health.Interval) * time.Millisecond
	if interval < minProbeTimeout {
		return minProbeTimeout
	}
	return interval
}

func WaitForServiceHealth(ctx context.Context, options WaitForServiceHealthOptions) error {
	return waitForServiceHealth(ctx, options, healthDependencies{
		canConnectToPort:    canConnectToPort,
		isReadyHTTPEndpoint: isReadyHTTPEndpoint,
		now:                 time.Now,
		sleep:               sleepForHealth,
	})
}

func CheckServiceHealth(health ResolvedHealthConfig) bool {
	return checkServiceHealth(context.Background(), health, healthDependencies{
		canConnectToPort:    canConnectToPort,
		isReadyHTTPEndpoint: isReadyHTTPEndpoint,
	})
}

func waitForServiceHealth(ctx context.Context, options WaitForServiceHealthOptions, dependencies healthDependencies) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if options.Health.Kind == HealthKindProcess {
		return throwIfExited(options.ReadExitCode, options.ServiceName)
	}

	timeout := time.Duration(options.Health.Timeout) * time.Millisecond
	interval := time.Duration(options.Health.Interval) * time.Millisecond
	startTime := dependencies.now()
	deadline := startTime.Add(timeout)
	consecutiveFailures := 0
	attempts := 0

	for dependencies.now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		healthy := checkServiceHealth(ctx, options.Health, dependencies)
		if err := ctx.Err(); err != nil {
			return err
		}
		if healthy {
			consecutiveFailures = 0
			return nil
		}

		consecutiveFailures++
		attempts++
		// Retries == 0 (the default) is treated as "no explicit cap on
		// consecutive failures" — only Timeout bounds the total wait. A
		// positive Retries enables an early-exit cap.
		if options.Health.Retries > 0 && consecutiveFailures > options.Health.Retries {
			return fmt.Errorf("Service %s failed its health check %d consecutive times.", options.ServiceName, consecutiveFailures)
		}

		if err := throwIfExited(options.ReadExitCode, options.ServiceName); err != nil {
			return err
		}

		if options.OnProgress != nil {
			options.OnProgress(attempts, dependencies.now().Sub(startTime))
		}

		if err := dependencies.sleep(ctx, interval); err != nil {
			return err
		}
	}

	return fmt.Errorf("Service %s did not pass its health check within %dms.", options.ServiceName, options.Health.Timeout)
}

func sleepForHealth(ctx context.Context, interval time.Duration) error {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func throwIfExited(readExitCode func() *int, serviceName string) error {
	if readExitCode == nil {
		return nil
	}

	exitCode := readExitCode()
	if exitCode == nil {
		return nil
	}

	return fmt.Errorf("Service %s exited before passing its health check with code %d.", serviceName, *exitCode)
}

func checkServiceHealth(ctx context.Context, health ResolvedHealthConfig, dependencies healthDependencies) bool {
	probeTimeout := probeTimeoutFor(health)

	switch health.Kind {
	case HealthKindProcess:
		return true

	case HealthKindTCP:
		if health.Host == nil || health.Port == nil {
			return false
		}

		resolvedHost, err := caddy.ResolveProxyHost(*health.Host)
		if err != nil {
			return false
		}

		return dependencies.canConnectToPort(ctx, resolvedHost, *health.Port, probeTimeout)

	case HealthKindHTTP:
		if health.URL == nil {
			return false
		}

		return dependencies.isReadyHTTPEndpoint(ctx, *health.URL, probeTimeout)

	default:
		return false
	}
}

func canConnectToPort(ctx context.Context, host string, port int, timeout time.Duration) bool {
	dialer := net.Dialer{Timeout: timeout}
	connection, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		return false
	}
	defer connection.Close()

	return true
}

func isReadyHTTPEndpoint(ctx context.Context, url string, timeout time.Duration) bool {
	client := http.Client{
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Timeout: timeout,
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()

	return response.StatusCode >= 200 && response.StatusCode < 300
}
